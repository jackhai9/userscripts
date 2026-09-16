import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  observeAutoOpenLeveragePositionState,
  resolveSymbolPositionSideStatus,
  resolveSymbolPositionStatus,
} from '../../../src/binance-orderbook-trade/core/auto-open-leverage.js';

test("user sees that other symbols do not prevent the current symbol from being confirmed flat", () => {
  // Given the current symbol and position observations are available
  const scenarioInputs = [{
    success: true,
    data: [
      { symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmount: '0.25' },
      { symbol: 'ETHUSDT', positionSide: 'SHORT', positionAmount: '-1.5' },
    ],
  }, 'HYPEUSDT'];

  // When the confirmed position transition is evaluated
  const observed = resolveSymbolPositionStatus(...scenarioInputs);

  // Then sees that other symbols do not prevent the current symbol from being confirmed flat
  assert.deepEqual(observed, {
    status: 'flat',
    matchingPositionCount: 0,
  });
});

test("user sees that all current-symbol position directions must be zero before reset", () => {
  // Given the current symbol and position observations are available
  const scenarioInputs = [{
    success: true,
    data: [
      { symbol: 'HYPEUSDT', positionSide: 'LONG', positionAmount: '0' },
      { symbol: 'HYPEUSDT', positionSide: 'SHORT', positionAmount: '-0.50' },
    ],
  }, 'HYPEUSDT'];

  // When the confirmed position transition is evaluated
  const observed = resolveSymbolPositionStatus(...scenarioInputs);

  // Then sees that all current-symbol position directions must be zero before reset
  assert.deepEqual(observed, {
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

test("user sees that close completion checks only the requested position side in hedge mode", () => {
  // Given the current symbol and position observations are available
  const payload = {
    success: true,
    data: [
      { symbol: 'HYPEUSDT', positionSide: 'LONG', positionAmount: '1.25' },
      { symbol: 'HYPEUSDT', positionSide: 'SHORT', positionAmount: '0' },
    ],
  };

  // When the confirmed position transition is evaluated
  const observed = resolveSymbolPositionSideStatus(payload, 'HYPEUSDT', 'LONG');

  // Then sees that close completion checks only the requested position side in hedge mode
  assert.deepEqual(observed, {
    status: 'has_position',
    matchingPositionCount: 1,
    positionQty: '1.25',
  });
  assert.deepEqual(resolveSymbolPositionSideStatus(payload, 'HYPEUSDT', 'SHORT'), {
    status: 'flat',
    matchingPositionCount: 1,
    positionQty: '0',
  });
});

test("user sees that close completion maps signed one-way positions to the requested side", () => {
  // Given the current symbol and position observations are available
  const longPayload = {
    success: true,
    data: [{ symbol: 'HYPEUSDT', positionSide: 'BOTH', positionAmount: '1.25' }],
  };
  const shortPayload = {
    success: true,
    data: [{ symbol: 'HYPEUSDT', positionSide: 'BOTH', positionAmount: '-1.25' }],
  };

  // When the confirmed position transition is evaluated
  const observed = resolveSymbolPositionSideStatus(longPayload, 'HYPEUSDT', 'LONG').status;

  // Then sees that close completion maps signed one-way positions to the requested side
  assert.equal(observed, 'has_position');
  assert.equal(resolveSymbolPositionSideStatus(longPayload, 'HYPEUSDT', 'SHORT').status, 'flat');
  assert.equal(resolveSymbolPositionSideStatus(shortPayload, 'HYPEUSDT', 'LONG').status, 'flat');
  assert.equal(resolveSymbolPositionSideStatus(shortPayload, 'HYPEUSDT', 'SHORT').status, 'has_position');
});

test("user sees that close completion rejects unknown position directions instead of guessing", () => {
  // Given the current symbol and position observations are available
  const scenarioInputs = [{
      success: true,
      data: [{ symbol: 'HYPEUSDT', positionSide: 'UNKNOWN', positionAmount: '1' }],
    }, 'HYPEUSDT', 'LONG'];

  // When the confirmed position transition is evaluated
  const observedFailure = captureThrownError(() => resolveSymbolPositionSideStatus(...scenarioInputs));

  // Then sees that close completion rejects unknown position directions instead of guessing
  assert.match(observedFailure.message, /持仓方向无效/);
  assert.throws(
    () => resolveSymbolPositionSideStatus({ success: true, data: [] }, 'HYPEUSDT', 'UNKNOWN'),
    /目标持仓方向无效/,
  );
});

test("user sees that directional recovery quantities preserve exact signed decimals and existing numeric inputs", () => {
  // Given the current symbol and position observations are available
  for (const [positionSide, positionAmount, side, positionQty] of [
    ['SHORT', '-1.000000000000000002', 'SHORT', '1.000000000000000002'],
    ['LONG', '1.000000000000000001', 'LONG', '1.000000000000000001'],
    ['BOTH', '-1.25', 'SHORT', '1.25'],
    ['BOTH', '-1.25', 'LONG', '0'],
    ['BOTH', '1.25', 'LONG', '1.25'],
    ['BOTH', '1.25', 'SHORT', '0'],
    ['SHORT', '-0.000', 'SHORT', '0'],
    ['SHORT', '-.50', 'SHORT', '0.5'],
    ['LONG', '1.', 'LONG', '1'],
    ['LONG', 0, 'LONG', '0'],
    ['BOTH', -1e-8, 'SHORT', '0.00000001'],
    ['BOTH', 1e21, 'LONG', '1000000000000000000000'],
  ]) {
    const state = resolveSymbolPositionSideStatus({
      success: true, data: [{ symbol: 'HYPEUSDT', positionSide, positionAmount }],
    }, 'HYPEUSDT', side);
    assert.equal(state.positionQty, positionQty);
    assert.equal(state.status, positionQty === '0' ? 'flat' : 'has_position');
  }
  // When the confirmed position transition is evaluated
  const observed = resolveSymbolPositionSideStatus({ success: true, data: [] }, 'HYPEUSDT', 'SHORT');

  // Then sees that directional recovery quantities preserve exact signed decimals and existing numeric inputs
  assert.deepEqual(observed, {
    status: 'flat', matchingPositionCount: 0, positionQty: '0',
  });
  for (const positionAmount of ['1e-8', '--1', 'NaN', Infinity, null]) {
    assert.throws(() => resolveSymbolPositionSideStatus({
      success: true, data: [{ symbol: 'HYPEUSDT', positionSide: 'BOTH', positionAmount }],
    }, 'HYPEUSDT', 'SHORT'), { name: 'PositionPayloadContractError' });
  }
});

test("user rejects unsuccessful or malformed current-symbol position responses", () => {
  // Given a failed response and a successful response with an unreadable position
  const payloads = [{ success: false, data: [] }, {
      success: true,
      data: [{ symbol: 'HYPEUSDT', positionAmount: 'unknown' }],
  }];

  // When position status is read from each response
  const failures = payloads.map((payload) => captureThrownError(() => resolveSymbolPositionStatus(payload, 'HYPEUSDT')));

  // Then each response fails with the specific position contract error
  assert.deepEqual(failures.map((error) => error.name), ['PositionPayloadContractError', 'PositionPayloadContractError']);
  assert.match(failures[0].message, /持仓接口返回失败/);
  assert.match(failures[1].message, /持仓数量无效/);
});

test("user queues once when a symbol first becomes confirmed flat", () => {
  // Given the current symbol and position observations are available
  const scenarioInputs = [null, {
    symbol: 'HYPEUSDT',
    status: 'unknown',
  }];

  // When the confirmed position transition is evaluated
  let observation = observeAutoOpenLeveragePositionState(...scenarioInputs);


  // Then queues once when a symbol first becomes confirmed flat
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

test("user queues once when positions transition from present to flat", () => {
  // Given the current symbol and position observations are available
  const scenarioInputs = [null, {
    symbol: 'HYPEUSDT',
    status: 'has_position',
  }];

  // When the confirmed position transition is evaluated
  let observation = observeAutoOpenLeveragePositionState(...scenarioInputs);


  // Then queues once when positions transition from present to flat
  assert.equal(observation.shouldReset, false);

  observation = observeAutoOpenLeveragePositionState(observation.state, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  assert.equal(observation.shouldReset, true);
});

test("user does not create a new flat epoch when the observed root temporarily disappears", () => {
  // Given the current symbol and position observations are available
  const scenarioInputs = [null, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  }];

  // When the confirmed position transition is evaluated
  let observation = observeAutoOpenLeveragePositionState(...scenarioInputs);


  // Then does not create a new flat epoch when the observed root temporarily disappears
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

test("user starts a new flat epoch for a different symbol", () => {
  // Given the current symbol and position observations are available
  const first = observeAutoOpenLeveragePositionState(null, {
    symbol: 'HYPEUSDT',
    status: 'flat',
  });
  // When the confirmed position transition is evaluated
  const second = observeAutoOpenLeveragePositionState(first.state, {
    symbol: 'BTCUSDT',
    status: 'flat',
  });

  // Then starts a new flat epoch for a different symbol
  assert.equal(second.shouldReset, true);
  assert.deepEqual(second.state, { symbol: 'BTCUSDT', lastKnownStatus: 'flat' });
});
