import test from 'node:test';
import assert from 'node:assert/strict';

import {
  observeAutoOpenLeveragePositionState,
  resolveSymbolPositionSideStatus,
  resolveSymbolPositionStatus,
} from '../../../src/binance-orderbook-trade/core/auto-open-leverage.js';

test('other symbols do not prevent the current symbol from being confirmed flat', () => {
  assert.deepEqual(resolveSymbolPositionStatus({
    success: true,
    data: [
      { symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmount: '0.25' },
      { symbol: 'ETHUSDT', positionSide: 'SHORT', positionAmount: '-1.5' },
    ],
  }, 'HYPEUSDT'), {
    status: 'flat',
    matchingPositionCount: 0,
  });
});

test('all current-symbol position directions must be zero before reset', () => {
  assert.deepEqual(resolveSymbolPositionStatus({
    success: true,
    data: [
      { symbol: 'HYPEUSDT', positionSide: 'LONG', positionAmount: '0' },
      { symbol: 'HYPEUSDT', positionSide: 'SHORT', positionAmount: '-0.50' },
    ],
  }, 'HYPEUSDT'), {
    status: 'has_position',
    matchingPositionCount: 2,
  });

  assert.deepEqual(resolveSymbolPositionStatus({
    success: true,
    data: [
      { symbol: 'HYPEUSDT', positionSide: 'LONG', positionAmount: '0.000' },
      { symbol: 'HYPEUSDT', positionSide: 'SHORT', positionAmount: 0 },
    ],
  }, 'HYPEUSDT'), {
    status: 'flat',
    matchingPositionCount: 2,
  });
});

test('close completion checks only the requested position side in hedge mode', () => {
  const payload = {
    success: true,
    data: [
      { symbol: 'HYPEUSDT', positionSide: 'LONG', positionAmount: '1.25' },
      { symbol: 'HYPEUSDT', positionSide: 'SHORT', positionAmount: '0' },
    ],
  };

  assert.deepEqual(resolveSymbolPositionSideStatus(payload, 'HYPEUSDT', 'LONG'), {
    status: 'has_position',
    matchingPositionCount: 1,
  });
  assert.deepEqual(resolveSymbolPositionSideStatus(payload, 'HYPEUSDT', 'SHORT'), {
    status: 'flat',
    matchingPositionCount: 1,
  });
});

test('close completion maps signed one-way positions to the requested side', () => {
  const longPayload = {
    success: true,
    data: [{ symbol: 'HYPEUSDT', positionSide: 'BOTH', positionAmount: '1.25' }],
  };
  const shortPayload = {
    success: true,
    data: [{ symbol: 'HYPEUSDT', positionSide: 'BOTH', positionAmount: '-1.25' }],
  };

  assert.equal(resolveSymbolPositionSideStatus(longPayload, 'HYPEUSDT', 'LONG').status, 'has_position');
  assert.equal(resolveSymbolPositionSideStatus(longPayload, 'HYPEUSDT', 'SHORT').status, 'flat');
  assert.equal(resolveSymbolPositionSideStatus(shortPayload, 'HYPEUSDT', 'LONG').status, 'flat');
  assert.equal(resolveSymbolPositionSideStatus(shortPayload, 'HYPEUSDT', 'SHORT').status, 'has_position');
});

test('close completion rejects unknown position directions instead of guessing', () => {
  assert.throws(
    () => resolveSymbolPositionSideStatus({
      success: true,
      data: [{ symbol: 'HYPEUSDT', positionSide: 'UNKNOWN', positionAmount: '1' }],
    }, 'HYPEUSDT', 'LONG'),
    /持仓方向无效/,
  );
  assert.throws(
    () => resolveSymbolPositionSideStatus({ success: true, data: [] }, 'HYPEUSDT', 'UNKNOWN'),
    /目标持仓方向无效/,
  );
});

test('rejects unsuccessful or malformed current-symbol position responses', () => {
  assert.throws(
    () => resolveSymbolPositionStatus({ success: false, data: [] }, 'HYPEUSDT'),
    (error) => (
      error.name === 'PositionPayloadContractError'
      && /持仓接口返回失败/.test(error.message)
    ),
  );
  assert.throws(
    () => resolveSymbolPositionStatus({
      success: true,
      data: [{ symbol: 'HYPEUSDT', positionAmount: 'unknown' }],
    }, 'HYPEUSDT'),
    (error) => (
      error.name === 'PositionPayloadContractError'
      && /持仓数量无效/.test(error.message)
    ),
  );
});

test('queues once when a symbol first becomes confirmed flat', () => {
  let observation = observeAutoOpenLeveragePositionState(null, {
    symbol: 'HYPEUSDT',
    status: 'unknown',
  });
  assert.equal(observation.shouldReset, false);

  observation = observeAutoOpenLeveragePositionState(observation.state, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  assert.equal(observation.shouldReset, true);

  observation = observeAutoOpenLeveragePositionState(observation.state, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  assert.equal(observation.shouldReset, false);
});

test('queues once when positions transition from present to flat', () => {
  let observation = observeAutoOpenLeveragePositionState(null, {
    symbol: 'HYPEUSDT',
    status: 'has_position',
  });
  assert.equal(observation.shouldReset, false);

  observation = observeAutoOpenLeveragePositionState(observation.state, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  assert.equal(observation.shouldReset, true);
});

test('does not create a new flat epoch when the observed root temporarily disappears', () => {
  let observation = observeAutoOpenLeveragePositionState(null, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  assert.equal(observation.shouldReset, true);

  observation = observeAutoOpenLeveragePositionState(observation.state, {
    symbol: 'HYPEUSDT',
    status: 'unknown',
  });
  assert.equal(observation.shouldReset, false);

  observation = observeAutoOpenLeveragePositionState(observation.state, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  assert.equal(observation.shouldReset, false);
});

test('starts a new flat epoch for a different symbol', () => {
  const first = observeAutoOpenLeveragePositionState(null, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  const second = observeAutoOpenLeveragePositionState(first.state, {
    symbol: 'BTCUSDT',
    status: 'flat',
  });

  assert.equal(second.shouldReset, true);
  assert.deepEqual(second.state, { symbol: 'BTCUSDT', lastKnownStatus: 'flat' });
});
