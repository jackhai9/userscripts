import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLadderActionSpec,
  getLadderPercentForMode,
} from '../../../src/binance-orderbook-trade/core/ladder-plan.js';

test('maps open and close ladder actions to order direction specs', () => {
  assert.deepEqual(getLadderActionSpec('OPEN_LONG'), {
    mode: 'OPEN',
    label: '阶梯开多',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'LONG',
  });
  assert.deepEqual(getLadderActionSpec('OPEN_SHORT'), {
    mode: 'OPEN',
    label: '阶梯开空',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'SHORT',
  });
  assert.deepEqual(getLadderActionSpec('CLOSE_LONG'), {
    mode: 'CLOSE',
    label: '阶梯平多',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'LONG',
  });
  assert.deepEqual(getLadderActionSpec('CLOSE_SHORT'), {
    mode: 'CLOSE',
    label: '阶梯平空',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'SHORT',
  });
});

test('rejects unknown ladder actions and resolves percent source by mode', () => {
  assert.equal(getLadderActionSpec('BAD_ACTION'), null);
  assert.equal(getLadderPercentForMode('OPEN', 30, 50), 30);
  assert.equal(getLadderPercentForMode('CLOSE', 30, 50), 50);
  assert.equal(getLadderPercentForMode('UNKNOWN', 30, 50), null);
});
