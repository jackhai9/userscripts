import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLocalizedText,
  localizedText,
  UI_LOCALE_EN,
  UI_LOCALE_ZH_CN,
} from '../../../src/binance-orderbook-trade/contracts/panel-copy.js';

import {
  createLadderProgress,
  formatCompletedLadderProgress,
  formatFailedLadderProgress,
  formatInterruptedLadderProgress,
  formatPositionClosedLadderProgress,
  formatStoppedLadderProgress,
  recordLadderCancelledOrder,
  recordLadderSubmittedOrder,
  setLadderPlannedOrders,
  snapshotLadderProgress,
} from '../../../src/binance-orderbook-trade/core/ladder-progress.js';

const zh = (value) => formatLocalizedText(value, UI_LOCALE_ZH_CN);
const en = (value) => formatLocalizedText(value, UI_LOCALE_EN);

test("user sees that ladder progress snapshot is detached from later mutations", () => {
  // Given the ladder task and confirmed activity are available
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 2);
  recordLadderSubmittedOrder(progress);

  const snapshot = snapshotLadderProgress(progress);
  // When the progress snapshot or status is produced
  recordLadderSubmittedOrder(progress);

  // Then sees that ladder progress snapshot is detached from later mutations
  assert.deepEqual(snapshot, {
    submittedOrders: 1,
    cancelledOrders: 0,
    plannedOrders: 2,
    currentPlanSubmittedOrders: 1,
  });
});

test("user sees that stopped ladder status reports confirmed submitted and cancelled orders", () => {
  // Given the ladder task and confirmed activity are available
  const progress = createLadderProgress();

  setLadderPlannedOrders(progress, 5);
  recordLadderSubmittedOrder(progress);
  recordLadderSubmittedOrder(progress);
  // When the progress snapshot or status is produced
  recordLadderCancelledOrder(progress);

  // Then sees that stopped ladder status reports confirmed submitted and cancelled orders
  assert.deepEqual(progress, {
    submittedOrders: 2,
    cancelledOrders: 1,
    plannedOrders: 5,
    currentPlanSubmittedOrders: 2,
  });
  assert.equal(
    zh(formatStoppedLadderProgress('阶梯开空', progress)),
    '阶梯开空已停止 · 已挂 2/5 笔 · 已撤 1 笔',
  );
});

test("user sees that stopped ladder status omits counters for actions that did not happen", () => {
  // Given the ladder task and confirmed activity are available
  const scenarioInputs = ['阶梯平多', createLadderProgress()];

  // When the progress snapshot or status is produced
  const observed = zh(formatStoppedLadderProgress(...scenarioInputs));

  // Then sees that stopped ladder status omits counters for actions that did not happen
  assert.equal(
    observed,
    '阶梯平多已停止',
  );

  const submittedOnly = createLadderProgress();
  setLadderPlannedOrders(submittedOnly, 3);
  recordLadderSubmittedOrder(submittedOnly);
  assert.equal(
    zh(formatStoppedLadderProgress('阶梯平空', submittedOnly)),
    '阶梯平空已停止 · 已挂 1/3 笔',
  );

  const stoppedBeforeFirstOrder = createLadderProgress();
  setLadderPlannedOrders(stoppedBeforeFirstOrder, 5);
  assert.equal(
    zh(formatStoppedLadderProgress('阶梯开空', stoppedBeforeFirstOrder)),
    '阶梯开空已停止 · 已挂 0/5 笔',
  );

  const cancelledOnly = createLadderProgress();
  recordLadderCancelledOrder(cancelledOnly);
  assert.equal(
    zh(formatStoppedLadderProgress('阶梯开多', cancelledOnly)),
    '阶梯开多已停止 · 已撤 1 笔',
  );
});

test("user sees that completed ladder status names the action and confirmed result", () => {
  // Given the ladder task and confirmed activity are available
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 5);
  // When the progress snapshot or status is produced
  for (let index = 0; index < 5; index += 1) recordLadderSubmittedOrder(progress);

  // Then sees that completed ladder status names the action and confirmed result
  assert.equal(
    zh(formatCompletedLadderProgress('阶梯平空', 5, 5, progress)),
    '阶梯平空已完成 · 已挂 5/5 笔',
  );

  const progressWithCancellation = createLadderProgress();
  setLadderPlannedOrders(progressWithCancellation, 5);
  for (let index = 0; index < 5; index += 1) recordLadderSubmittedOrder(progressWithCancellation);
  recordLadderCancelledOrder(progressWithCancellation);
  assert.equal(
    zh(formatCompletedLadderProgress('阶梯平空', 5, 5, progressWithCancellation)),
    '阶梯平空已完成 · 已挂 5/5 笔 · 已撤 1 笔',
  );
});

test("user sees that confirmed flat position is an ended business outcome with retained progress", () => {
  // Given the ladder task and confirmed activity are available
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 3);
  // When the progress snapshot or status is produced
  recordLadderCancelledOrder(progress);

  // Then sees that confirmed flat position is an ended business outcome with retained progress
  assert.equal(
    zh(formatPositionClosedLadderProgress('阶梯平空', progress)),
    '阶梯平空已结束 · 当前方向已无持仓 · 已挂 0/3 笔 · 已撤 1 笔',
  );
});

test("user sees that failed and interrupted ladder statuses retain confirmed progress", () => {
  // Given the ladder task and confirmed activity are available
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 5);
  recordLadderSubmittedOrder(progress);
  // When the progress snapshot or status is produced
  recordLadderCancelledOrder(progress);

  // Then sees that failed and interrupted ladder statuses retain confirmed progress
  assert.equal(
    zh(formatFailedLadderProgress('阶梯开多', '数量框状态未稳定', progress)),
    '阶梯开多失败：已挂 1/5 笔 · 已撤 1 笔 · 数量框状态未稳定',
  );
  assert.equal(
    zh(formatInterruptedLadderProgress('阶梯开多', '交易对已切换', progress)),
    '阶梯开多已中止：交易对已切换 · 已挂 1/5 笔 · 已撤 1 笔',
  );

  assert.equal(
    zh(formatFailedLadderProgress('阶梯开空', '数量框状态未稳定', createLadderProgress())),
    '阶梯开空失败：数量框状态未稳定',
  );
  assert.equal(
    zh(formatInterruptedLadderProgress('阶梯平多', '交易对已切换', createLadderProgress())),
    '阶梯平多已中止：交易对已切换',
  );

  const buttonNotReady = createLadderProgress();
  setLadderPlannedOrders(buttonNotReady, 2);
  recordLadderSubmittedOrder(buttonNotReady);
  assert.equal(
    zh(formatFailedLadderProgress(
      '阶梯开空',
      '下单按钮 3 秒内未恢复可点击',
      buttonNotReady,
    )),
    '阶梯开空失败：已挂 1/2 笔 · 下单按钮 3 秒内未恢复可点击',
  );
});

test("user sees that ladder progress rejects invalid counters instead of masking them", () => {
  // Given the ladder task and confirmed activity are available
  const scenarioInputs = ['阶梯开多', { submittedOrders: -1, cancelledOrders: 0 }];

  // When the progress snapshot or status is produced
  const observedFailure = captureThrownError(() => formatStoppedLadderProgress(...scenarioInputs));

  // Then sees that ladder progress rejects invalid counters instead of masking them
  assert.match(observedFailure.message, /阶梯进度状态无效/);
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

test("user sees that a replacement plan resets only the ratio numerator and retains cumulative activity", () => {
  // Given the ladder task and confirmed activity are available
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 5);
  recordLadderSubmittedOrder(progress);
  recordLadderSubmittedOrder(progress);
  recordLadderCancelledOrder(progress);
  recordLadderCancelledOrder(progress);

  setLadderPlannedOrders(progress, 3);
  // When the progress snapshot or status is produced
  recordLadderSubmittedOrder(progress);

  // Then sees that a replacement plan resets only the ratio numerator and retains cumulative activity
  assert.equal(
    zh(formatStoppedLadderProgress('阶梯平空', progress)),
    '阶梯平空已停止 · 已挂 1/3 笔 · 已撤 2 笔',
  );
  assert.deepEqual(progress, {
    submittedOrders: 3,
    cancelledOrders: 2,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 1,
  });
});

test("user sees that ladder progress renders the same result data in English", () => {
  // Given the ladder task and confirmed activity are available
  const progress = createLadderProgress();
  setLadderPlannedOrders(progress, 3);
  recordLadderSubmittedOrder(progress);
  // When the progress snapshot or status is produced
  recordLadderCancelledOrder(progress);

  // Then sees that ladder progress renders the same result data in English
  assert.equal(
    en(formatFailedLadderProgress(
      localizedText('阶梯平空', 'Close Short'),
      localizedText('数量框状态未稳定', 'Quantity input did not stabilize'),
      progress,
    )),
    'Close Short failed: Placed 1/3 · Cancelled 1 · Quantity input did not stabilize',
  );
});
