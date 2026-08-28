import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLadderProgress,
  formatCompletedLadderProgress,
  formatFailedLadderProgress,
  formatInterruptedLadderProgress,
  formatStoppedLadderProgress,
  recordLadderCancelledOrder,
  recordLadderSubmittedOrder,
} from '../../../src/binance-orderbook-trade/core/ladder-progress.js';

test('stopped ladder status reports confirmed submitted and cancelled orders', () => {
  const progress = createLadderProgress();

  recordLadderSubmittedOrder(progress);
  recordLadderSubmittedOrder(progress);
  recordLadderCancelledOrder(progress);

  assert.deepEqual(progress, {
    submittedOrders: 2,
    cancelledOrders: 1,
  });
  assert.equal(
    formatStoppedLadderProgress('阶梯开空', progress),
    '阶梯开空已停止 · 已挂 2 笔 · 已撤 1 笔',
  );
});

test('stopped ladder status keeps explicit zero counts', () => {
  assert.equal(
    formatStoppedLadderProgress('阶梯平多', createLadderProgress()),
    '阶梯平多已停止 · 已挂 0 笔 · 已撤 0 笔',
  );
});

test('completed ladder status names the action and confirmed result', () => {
  const progress = createLadderProgress();
  for (let index = 0; index < 5; index += 1) recordLadderSubmittedOrder(progress);

  assert.equal(
    formatCompletedLadderProgress('阶梯平空', 5, 5, progress),
    '阶梯平空已完成 · 已挂 5/5 笔',
  );

  recordLadderSubmittedOrder(progress);
  recordLadderSubmittedOrder(progress);
  recordLadderCancelledOrder(progress);
  assert.equal(
    formatCompletedLadderProgress('阶梯平空', 5, 5, progress),
    '阶梯平空已完成 · 已挂 5/5 笔 · 已撤 1 笔',
  );
});

test('failed and interrupted ladder statuses retain confirmed progress', () => {
  const progress = createLadderProgress();
  recordLadderSubmittedOrder(progress);
  recordLadderCancelledOrder(progress);

  assert.equal(
    formatFailedLadderProgress('阶梯开多', '数量框状态未稳定', progress),
    '阶梯开多失败：数量框状态未稳定 · 已挂 1 笔 · 已撤 1 笔',
  );
  assert.equal(
    formatInterruptedLadderProgress('阶梯开多', '交易对已切换', progress),
    '阶梯开多已中止：交易对已切换 · 已挂 1 笔 · 已撤 1 笔',
  );
});

test('ladder progress rejects invalid counters instead of masking them', () => {
  assert.throws(
    () => formatStoppedLadderProgress('阶梯开多', { submittedOrders: -1, cancelledOrders: 0 }),
    /Invalid ladder progress/,
  );
  assert.throws(
    () => recordLadderCancelledOrder({ submittedOrders: 0, cancelledOrders: 1.5 }),
    /Invalid ladder progress/,
  );
  assert.throws(
    () => formatCompletedLadderProgress('阶梯开多', 1, 2, {
      submittedOrders: 1,
      cancelledOrders: 0,
    }),
    /Completed ladder progress mismatch/,
  );
});
