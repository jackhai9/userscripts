const LADDER_ACTION_SPECS = {
  OPEN_LONG: {
    mode: 'OPEN',
    label: '阶梯开多',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'LONG',
  },
  OPEN_SHORT: {
    mode: 'OPEN',
    label: '阶梯开空',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'SHORT',
  },
  CLOSE_LONG: {
    mode: 'CLOSE',
    label: '阶梯平多',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'LONG',
  },
  CLOSE_SHORT: {
    mode: 'CLOSE',
    label: '阶梯平空',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'SHORT',
  },
};

export function getLadderActionSpec(actionType) {
  const spec = LADDER_ACTION_SPECS[actionType];
  return spec ? { ...spec } : null;
}

export function getLadderPercentForMode(mode, openPercent, closePercent) {
  if (mode === 'OPEN') return openPercent;
  if (mode === 'CLOSE') return closePercent;
  return null;
}
