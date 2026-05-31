import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOrderFeedback,
  evaluateOrderSubmitAcknowledgement,
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
