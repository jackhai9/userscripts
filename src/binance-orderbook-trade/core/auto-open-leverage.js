import { addDecimalStrings, formatDecimalParts, normalizeDecimalString } from './decimal.js';

const POSITION_STATUSES = new Set(['unknown', 'has_position', 'flat']);

function createPositionPayloadContractError(message) {
  const error = new Error(message);
  error.name = 'PositionPayloadContractError';
  return error;
}

function parsePositionAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    return Number(value);
  }
  throw createPositionPayloadContractError(`持仓数量无效：${String(value)}`);
}

/** Preserve API decimal strings when measuring progress between position reads. */
function parsePositionQuantity(value) {
  parsePositionAmount(value);
  const raw = String(value).trim();
  const negative = raw.startsWith('-');
  const magnitude = negative ? raw.slice(1) : raw;
  let quantity;
  if (typeof value === 'number' && /e/i.test(magnitude)) {
    const [coefficient, exponent] = magnitude.toLowerCase().split('e');
    const [integer, fraction = ''] = coefficient.split('.');
    const scale = fraction.length - Number(exponent);
    const digits = BigInt(integer + fraction);
    quantity = scale >= 0
      ? formatDecimalParts(digits, scale)
      : formatDecimalParts(digits * 10n ** BigInt(-scale), 0);
  } else {
    quantity = normalizeDecimalString(magnitude.replace(/^\./, '0.').replace(/\.$/, '.0'));
  }
  if (quantity === null) throw createPositionPayloadContractError('Invalid position quantity');
  return { negative, quantity };
}

export function resolveSymbolPositionStatus(payload, symbol) {
  if (payload?.success !== true) throw createPositionPayloadContractError('持仓接口返回失败');
  if (!Array.isArray(payload.data)) throw createPositionPayloadContractError('持仓接口数据格式异常');
  if (!symbol) throw createPositionPayloadContractError('持仓接口缺少交易对');

  const positions = payload.data.filter((position) => position?.symbol === symbol);
  const hasPosition = positions.some((position) => parsePositionAmount(position.positionAmount) !== 0);
  return {
    status: hasPosition ? 'has_position' : 'flat',
    matchingPositionCount: positions.length,
  };
}

export function resolveSymbolPositionSideStatus(payload, symbol, side) {
  if (payload?.success !== true) throw createPositionPayloadContractError('持仓接口返回失败');
  if (!Array.isArray(payload.data)) throw createPositionPayloadContractError('持仓接口数据格式异常');
  if (!symbol) throw createPositionPayloadContractError('持仓接口缺少交易对');
  if (side !== 'LONG' && side !== 'SHORT') {
    throw createPositionPayloadContractError(`目标持仓方向无效：${String(side)}`);
  }

  const positions = payload.data.filter((position) => position?.symbol === symbol);
  let matchingPositionCount = 0;
  let positionQty = '0';
  for (const position of positions) {
    const positionSide = position.positionSide;
    if (!['BOTH', 'LONG', 'SHORT'].includes(positionSide)) {
      throw createPositionPayloadContractError(`持仓方向无效：${String(positionSide)}`);
    }
    const { negative, quantity } = parsePositionQuantity(position.positionAmount);
    if (positionSide === side) {
      matchingPositionCount += 1;
      positionQty = addDecimalStrings(positionQty, quantity);
      continue;
    }
    if (positionSide === 'BOTH') {
      matchingPositionCount += 1;
      if ((side === 'LONG' && !negative) || (side === 'SHORT' && negative)) {
        positionQty = addDecimalStrings(positionQty, quantity);
      }
    }
  }
  return {
    status: positionQty !== '0' ? 'has_position' : 'flat',
    matchingPositionCount,
    positionQty,
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
