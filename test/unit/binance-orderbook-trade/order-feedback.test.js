import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyOrderFeedback,
  evaluateOrderSubmitAcknowledgement,
  getBinanceApiErrorCode,
  isBinancePlaceOrderSuccessPayload,
  isBinancePostOnlyMakerRejectCode,
  isOpenLadderOpenOrdersCapacityFeedback,
  isPostOnlyMakerRejectionFeedback,
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

test('recognizes open ladder capacity failures only when feedback points to open orders', () => {
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('可开数量不足，请取消当前挂单后重试'), true);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('Order failed: insufficient margin from existing open orders'), true);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('下单失败：余额不足'), false);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('可用余额不足'), false);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('可开数量不足'), false);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('Order failed: insufficient margin'), false);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('Order failed: not enough available balance'), false);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('只减仓订单失败。请取消此币种的当前挂单，然后重试。'), false);
  assert.equal(isOpenLadderOpenOrdersCapacityFeedback('委托已提交'), false);
});

test('reads Binance API error codes without depending on localized messages', () => {
  assert.equal(getBinanceApiErrorCode({ code: -5022, msg: 'any text' }), -5022);
  assert.equal(getBinanceApiErrorCode({ code: '-5022', message: '任意文案' }), -5022);
  assert.equal(getBinanceApiErrorCode({ code: 90805022, message: '任意文案' }), 90805022);
  assert.equal(getBinanceApiErrorCode({ code: '90805022', message: '任意文案' }), 90805022);
  assert.equal(getBinanceApiErrorCode({ code: 0, success: true }), null);
  assert.equal(getBinanceApiErrorCode({ code: '000000', success: true }), null);
  assert.equal(getBinanceApiErrorCode({ code: -2019, msg: 'insufficient margin' }), -2019);
  assert.equal(getBinanceApiErrorCode({ code: 1.5, msg: 'invalid numeric code' }), null);
  assert.equal(getBinanceApiErrorCode({ code: '1.5', msg: 'invalid numeric code' }), null);
  assert.equal(getBinanceApiErrorCode({ code: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(getBinanceApiErrorCode({ message: 'Post Only order rejected' }), null);
  assert.equal(getBinanceApiErrorCode({ data: { code: -5022 } }), null);
});

test('recognizes only the verified Binance place-order success payload contract', () => {
  assert.equal(isBinancePlaceOrderSuccessPayload({ code: 0, success: true }), true);
  assert.equal(isBinancePlaceOrderSuccessPayload({ code: '000000', success: true }), true);
  assert.equal(isBinancePlaceOrderSuccessPayload({ success: true, data: {} }), true);

  assert.equal(isBinancePlaceOrderSuccessPayload({ code: -5022, success: true }), false);
  assert.equal(isBinancePlaceOrderSuccessPayload({ code: '90805022', success: true }), false);
  assert.equal(isBinancePlaceOrderSuccessPayload({ code: 0 }), false);
  assert.equal(isBinancePlaceOrderSuccessPayload({ success: false }), false);
  assert.equal(isBinancePlaceOrderSuccessPayload({}), false);
  assert.equal(isBinancePlaceOrderSuccessPayload([]), false);
  assert.equal(isBinancePlaceOrderSuccessPayload(null), false);
});

test('recognizes only verified Binance Post Only maker rejection codes', () => {
  assert.equal(isBinancePostOnlyMakerRejectCode(-5022), true);
  assert.equal(isBinancePostOnlyMakerRejectCode(90805022), true);
  assert.equal(isBinancePostOnlyMakerRejectCode('90805022'), false);
  assert.equal(isBinancePostOnlyMakerRejectCode(0), false);
  assert.equal(isBinancePostOnlyMakerRejectCode(-2019), false);
  assert.equal(isBinancePostOnlyMakerRejectCode(90805021), false);
});

test('recognizes Post Only maker-execution rejection feedback without exact-message matching', () => {
  assert.equal(isPostOnlyMakerRejectionFeedback(
    '由于该只做Maker订单(Post Only)未作为Maker执行，因此将被拒绝。该订单不会记录在订单历史记录中。'
  ), true);
  assert.equal(isPostOnlyMakerRejectionFeedback(
    '只做 Maker 订单无法作为 Maker 成交，已被拒绝。'
  ), true);
  assert.equal(isPostOnlyMakerRejectionFeedback(
    'Due to the order could not be executed as maker, the Post Only order will be rejected.'
  ), true);
  assert.equal(isPostOnlyMakerRejectionFeedback(
    'The Post-Only order cannot execute as a maker and was rejected without being recorded.'
  ), true);
});

test('does not infer maker-price conflicts from generic or unrelated rejection feedback', () => {
  assert.equal(isPostOnlyMakerRejectionFeedback('Order rejected'), false);
  assert.equal(isPostOnlyMakerRejectionFeedback('只做Maker (Post Only) 状态丢失'), false);
  assert.equal(isPostOnlyMakerRejectionFeedback('Post Only order rejected'), false);
  assert.equal(isPostOnlyMakerRejectionFeedback('订单未作为Maker执行，因此将被拒绝'), false);
  assert.equal(isPostOnlyMakerRejectionFeedback('FOK order could not be filled immediately and was rejected'), false);
  assert.equal(isPostOnlyMakerRejectionFeedback('只减仓订单失败，请取消当前挂单后重试'), false);
});
