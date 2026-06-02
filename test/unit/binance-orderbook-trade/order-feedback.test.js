import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOrderFeedback,
  evaluateOrderSubmitAcknowledgement,
  isReduceOnlyOpenOrdersConflictFeedback,
} from '../../../src/binance-orderbook-trade/core/order-feedback.js';

test('classifies localized and English order feedback', () => {
  assert.equal(classifyOrderFeedback('委托已提交'), 'success');
  assert.equal(classifyOrderFeedback('Order placed successfully'), 'success');
  assert.equal(classifyOrderFeedback('设置成功'), 'unknown');
  assert.equal(classifyOrderFeedback('余额不足，下单失败'), 'failure');
  assert.equal(classifyOrderFeedback('Order rejected'), 'failure');
  assert.equal(classifyOrderFeedback('请确认订单参数'), 'unknown');
});

test('does not acknowledge ladder submission without new success feedback', () => {
  assert.deepEqual(evaluateOrderSubmitAcknowledgement({
    feedback: '',
    isNewFeedback: true,
    sawBusy: true,
    busy: false,
  }), { status: 'pending' });

  assert.deepEqual(evaluateOrderSubmitAcknowledgement({
    feedback: '委托已提交',
    isNewFeedback: false,
    sawBusy: true,
    busy: false,
  }), { status: 'pending' });
});

test('acknowledges only new success feedback and surfaces failure text', () => {
  assert.deepEqual(evaluateOrderSubmitAcknowledgement({
    feedback: '委托已提交',
    isNewFeedback: true,
    sawBusy: false,
    busy: false,
  }), { status: 'success' });

  assert.deepEqual(evaluateOrderSubmitAcknowledgement({
    feedback: 'Order placed successfully',
    isNewFeedback: true,
    sawBusy: false,
    busy: false,
  }), { status: 'success' });

  assert.deepEqual(evaluateOrderSubmitAcknowledgement({
    feedback: '设置成功',
    isNewFeedback: true,
    sawBusy: false,
    busy: false,
  }), { status: 'pending' });

  assert.deepEqual(evaluateOrderSubmitAcknowledgement({
    feedback: '下单失败：余额不足',
    isNewFeedback: true,
    sawBusy: false,
    busy: false,
  }), { status: 'failure', message: '下单失败：余额不足' });
});

test('recognizes reduce-only failures caused by existing open orders', () => {
  assert.equal(isReduceOnlyOpenOrdersConflictFeedback('只减仓订单失败。请取消此币种的当前挂单，然后重试。'), true);
  assert.equal(isReduceOnlyOpenOrdersConflictFeedback('只减仓订单失败。如果您有该合约的未平仓头寸和挂单，请取消挂单后重试。如果您没有任何仓位，请取消只减仓选项后重试。'), true);
  assert.equal(isReduceOnlyOpenOrdersConflictFeedback('下单失败：余额不足'), false);
  assert.equal(isReduceOnlyOpenOrdersConflictFeedback('委托已提交'), false);
});
