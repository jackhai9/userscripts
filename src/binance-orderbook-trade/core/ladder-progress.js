function assertLadderProgress(progress) {
  if (
    !progress
    || !Number.isInteger(progress.submittedOrders)
    || progress.submittedOrders < 0
    || !Number.isInteger(progress.cancelledOrders)
    || progress.cancelledOrders < 0
    || !Number.isInteger(progress.currentPlanSubmittedOrders)
    || progress.currentPlanSubmittedOrders < 0
    || (
      progress.plannedOrders === null
        ? progress.currentPlanSubmittedOrders !== 0
        : !(
          Number.isInteger(progress.plannedOrders)
          && progress.plannedOrders > 0
          && progress.currentPlanSubmittedOrders <= progress.plannedOrders
        )
    )
  ) {
    throw new Error('阶梯进度状态无效');
  }
}

function assertLadderLabel(label) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('阶梯动作名称无效');
  }
}

function assertLadderMessage(message) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new Error('阶梯进度信息无效');
  }
}

function formatLadderProgressCounts(progress) {
  assertLadderProgress(progress);
  const counts = [];
  if (progress.plannedOrders !== null) {
    counts.push(`已挂 ${progress.currentPlanSubmittedOrders}/${progress.plannedOrders} 笔`);
  } else if (progress.submittedOrders > 0) {
    counts.push(`已挂 ${progress.submittedOrders} 笔`);
  }
  if (progress.cancelledOrders > 0) counts.push(`已撤 ${progress.cancelledOrders} 笔`);
  return counts;
}

function appendLadderProgressCounts(status, progress) {
  const counts = formatLadderProgressCounts(progress);
  return counts.length > 0 ? `${status} · ${counts.join(' · ')}` : status;
}

/**
 * The shared object remains readable after an AbortSignal rejects the running ladder promise.
 */
export function createLadderProgress() {
  return {
    submittedOrders: 0,
    cancelledOrders: 0,
    plannedOrders: null,
    currentPlanSubmittedOrders: 0,
  };
}

export function snapshotLadderProgress(progress) {
  assertLadderProgress(progress);
  return {
    submittedOrders: progress.submittedOrders,
    cancelledOrders: progress.cancelledOrders,
    plannedOrders: progress.plannedOrders,
    currentPlanSubmittedOrders: progress.currentPlanSubmittedOrders,
  };
}

export function setLadderPlannedOrders(progress, plannedOrders) {
  assertLadderProgress(progress);
  if (!Number.isInteger(plannedOrders) || plannedOrders <= 0) {
    throw new Error('阶梯计划笔数无效');
  }
  progress.plannedOrders = plannedOrders;
  progress.currentPlanSubmittedOrders = 0;
}

export function recordLadderSubmittedOrder(progress) {
  assertLadderProgress(progress);
  if (
    progress.plannedOrders !== null
    && progress.currentPlanSubmittedOrders >= progress.plannedOrders
  ) {
    throw new Error('阶梯已挂笔数超过计划');
  }
  progress.submittedOrders += 1;
  if (progress.plannedOrders !== null) progress.currentPlanSubmittedOrders += 1;
}

export function recordLadderCancelledOrder(progress) {
  assertLadderProgress(progress);
  progress.cancelledOrders += 1;
}

export function formatStoppedLadderProgress(label, progress) {
  assertLadderLabel(label);
  return appendLadderProgressCounts(`${label}已停止`, progress);
}

export function formatInterruptedLadderProgress(label, reason, progress) {
  assertLadderLabel(label);
  assertLadderMessage(reason);
  return appendLadderProgressCounts(`${label}已中止：${reason}`, progress);
}

export function formatFailedLadderProgress(label, message, progress) {
  assertLadderLabel(label);
  assertLadderMessage(message);
  const counts = formatLadderProgressCounts(progress);
  const details = counts.length > 0 ? `${counts.join(' · ')} · ${message}` : message;
  return `${label}失败：${details}`;
}

export function formatCompletedLadderProgress(label, completedOrders, totalOrders, progress) {
  assertLadderLabel(label);
  assertLadderProgress(progress);
  if (
    !Number.isInteger(completedOrders)
    || completedOrders < 0
    || !Number.isInteger(totalOrders)
    || totalOrders < 0
  ) {
    throw new Error('阶梯完成笔数无效');
  }
  if (completedOrders !== totalOrders) {
    throw new Error('阶梯完成进度与计划不一致');
  }
  if (
    progress.plannedOrders !== totalOrders
    || progress.currentPlanSubmittedOrders !== completedOrders
  ) {
    throw new Error('阶梯完成进度与计划不一致');
  }
  const cancelledText = progress.cancelledOrders > 0
    ? ` · 已撤 ${progress.cancelledOrders} 笔`
    : '';
  return `${label}已完成 · 已挂 ${completedOrders}/${totalOrders} 笔${cancelledText}`;
}

export function formatPositionClosedLadderProgress(label, progress) {
  assertLadderLabel(label);
  return appendLadderProgressCounts(`${label}已结束 · 当前方向已无持仓`, progress);
}
