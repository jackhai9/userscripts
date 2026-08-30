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
  setLadderPlannedOrders,
  snapshotLadderProgress,
} from '../../../src/binance-orderbook-trade/core/ladder-progress.js';

test('ladder progress snapshot is detached from later mutations', () => {
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 2);
  recordLadderSubmittedOrder(progress);

  const snapshot = snapshotLadderProgress(progress);
  recordLadderSubmittedOrder(progress);

  assert.deepEqual(snapshot, {
    submittedOrders: 1,
    cancelledOrders: 0,
    plannedOrders: 2,
    currentPlanSubmittedOrders: 1,
  });
});

test('stopped ladder status reports confirmed submitted and cancelled orders', () => {
  const progress = createLadderProgress();

  setLadderPlannedOrders(progress, 5);
  recordLadderSubmittedOrder(progress);
  recordLadderSubmittedOrder(progress);
  recordLadderCancelledOrder(progress);

  assert.deepEqual(progress, {
    submittedOrders: 2,
    cancelledOrders: 1,
    plannedOrders: 5,
    currentPlanSubmittedOrders: 2,
  });
  assert.equal(
    formatStoppedLadderProgress('阶梯开空', progress),
    '阶梯开空已停止 · 已挂 2/5 笔 · 已撤 1 笔',
  );
});

test('stopped ladder status omits counters for actions that did not happen', () => {
  assert.equal(
    formatStoppedLadderProgress('阶梯平多', createLadderProgress()),
    '阶梯平多已停止',
  );

  const submittedOnly = createLadderProgress();
  setLadderPlannedOrders(submittedOnly, 3);
  recordLadderSubmittedOrder(submittedOnly);
  assert.equal(
    formatStoppedLadderProgress('阶梯平空', submittedOnly),
    '阶梯平空已停止 · 已挂 1/3 笔',
  );

  const stoppedBeforeFirstOrder = createLadderProgress();
  setLadderPlannedOrders(stoppedBeforeFirstOrder, 5);
  assert.equal(
    formatStoppedLadderProgress('阶梯开空', stoppedBeforeFirstOrder),
    '阶梯开空已停止 · 已挂 0/5 笔',
  );

  const cancelledOnly = createLadderProgress();
  recordLadderCancelledOrder(cancelledOnly);
  assert.equal(
    formatStoppedLadderProgress('阶梯开多', cancelledOnly),
    '阶梯开多已停止 · 已撤 1 笔',
  );
});

test('completed ladder status names the action and confirmed result', () => {
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 5);
  for (let index = 0; index < 5; index += 1) recordLadderSubmittedOrder(progress);

  assert.equal(
    formatCompletedLadderProgress('阶梯平空', 5, 5, progress),
    '阶梯平空已完成 · 已挂 5/5 笔',
  );

  const progressWithCancellation = createLadderProgress();
  setLadderPlannedOrders(progressWithCancellation, 5);
  for (let index = 0; index < 5; index += 1) recordLadderSubmittedOrder(progressWithCancellation);
  recordLadderCancelledOrder(progressWithCancellation);
  assert.equal(
    formatCompletedLadderProgress('阶梯平空', 5, 5, progressWithCancellation),
    '阶梯平空已完成 · 已挂 5/5 笔 · 已撤 1 笔',
  );
});

test('failed and interrupted ladder statuses retain confirmed progress', () => {
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 5);
  recordLadderSubmittedOrder(progress);
  recordLadderCancelledOrder(progress);

  assert.equal(
    formatFailedLadderProgress('阶梯开多', '数量框状态未稳定', progress),
    '阶梯开多失败：已挂 1/5 笔 · 已撤 1 笔 · 数量框状态未稳定',
  );
  assert.equal(
    formatInterruptedLadderProgress('阶梯开多', '交易对已切换', progress),
    '阶梯开多已中止：交易对已切换 · 已挂 1/5 笔 · 已撤 1 笔',
  );

  assert.equal(
    formatFailedLadderProgress('阶梯开空', '数量框状态未稳定', createLadderProgress()),
    '阶梯开空失败：数量框状态未稳定',
  );
  assert.equal(
    formatInterruptedLadderProgress('阶梯平多', '交易对已切换', createLadderProgress()),
    '阶梯平多已中止：交易对已切换',
  );

  const buttonNotReady = createLadderProgress();
  setLadderPlannedOrders(buttonNotReady, 2);
  recordLadderSubmittedOrder(buttonNotReady);
  assert.equal(
    formatFailedLadderProgress(
      '阶梯开空',
      '下单按钮 3 秒内未恢复可点击',
      buttonNotReady,
    ),
    '阶梯开空失败：已挂 1/2 笔 · 下单按钮 3 秒内未恢复可点击',
  );
});

test('ladder progress rejects invalid counters instead of masking them', () => {
  assert.throws(
    () => formatStoppedLadderProgress('阶梯开多', { submittedOrders: -1, cancelledOrders: 0 }),
    /阶梯进度状态无效/,
  );
  assert.throws(
    () => recordLadderCancelledOrder({ submittedOrders: 0, cancelledOrders: 1.5 }),
    /阶梯进度状态无效/,
  );
  assert.throws(
    () => formatCompletedLadderProgress('阶梯开多', 1, 2, {
      submittedOrders: 1,
      cancelledOrders: 0,
      plannedOrders: 2,
      currentPlanSubmittedOrders: 1,
    }),
    /阶梯完成进度与计划不一致/,
  );

  assert.throws(
    () => setLadderPlannedOrders(createLadderProgress(), 0),
    /阶梯计划笔数无效/,
  );

  const completedProgress = createLadderProgress();
  setLadderPlannedOrders(completedProgress, 1);
  recordLadderSubmittedOrder(completedProgress);
  assert.throws(
    () => recordLadderSubmittedOrder(completedProgress),
    /阶梯已挂笔数超过计划/,
  );
});

test('a replacement plan resets only the ratio numerator and retains cumulative activity', () => {
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 5);
  recordLadderSubmittedOrder(progress);
  recordLadderSubmittedOrder(progress);
  recordLadderCancelledOrder(progress);
  recordLadderCancelledOrder(progress);

  setLadderPlannedOrders(progress, 3);
  recordLadderSubmittedOrder(progress);

  assert.equal(
    formatStoppedLadderProgress('阶梯平空', progress),
    '阶梯平空已停止 · 已挂 1/3 笔 · 已撤 2 笔',
  );
  assert.deepEqual(progress, {
    submittedOrders: 3,
    cancelledOrders: 2,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 1,
  });
});
