const POSITION_STATUSES = new Set(['unknown', 'has_position', 'flat']);

function parsePositionAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    return Number(value);
  }
  throw new Error(`持仓数量无效：${String(value)}`);
}

export function resolveSymbolPositionStatus(payload, symbol) {
  if (payload?.success !== true) throw new Error('持仓接口返回失败');
  if (!Array.isArray(payload.data)) throw new Error('持仓接口数据格式异常');
  if (!symbol) throw new Error('持仓接口缺少交易对');

  const positions = payload.data.filter((position) => position?.symbol === symbol);
  const hasPosition = positions.some((position) => parsePositionAmount(position.positionAmount) !== 0);
  return {
    status: hasPosition ? 'has_position' : 'flat',
    matchingPositionCount: positions.length,
  };
}

/**
 * Tracks confirmed position epochs without treating a temporarily missing DOM root
 * as a new flat transition.
 */
export function observeAutoOpenLeveragePositionState(previousState, observation) {
  const { symbol, status } = observation;
  if (!symbol) throw new Error('自动杠杆检查缺少交易对');
  if (!POSITION_STATUSES.has(status)) {
    throw new Error(`自动杠杆持仓状态无效：${status}`);
  }

  const isSameSymbol = previousState?.symbol === symbol;
  const previousKnownStatus = isSameSymbol ? previousState.lastKnownStatus : null;
  const lastKnownStatus = status === 'unknown' ? previousKnownStatus : status;

  return {
    state: { symbol, lastKnownStatus },
    shouldReset: status === 'flat' && previousKnownStatus !== 'flat',
  };
}
