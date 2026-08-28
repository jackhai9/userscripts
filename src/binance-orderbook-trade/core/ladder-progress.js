function assertLadderProgress(progress) {
  if (
    !progress
    || !Number.isInteger(progress.submittedOrders)
    || progress.submittedOrders < 0
    || !Number.isInteger(progress.cancelledOrders)
    || progress.cancelledOrders < 0
  ) {
    throw new Error('Invalid ladder progress');
  }
}

function assertLadderLabel(label) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('Invalid ladder label');
  }
}

function assertLadderMessage(message) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new Error('Invalid ladder progress message');
  }
}

function formatLadderProgressCounts(progress) {
  assertLadderProgress(progress);
  return `已挂 ${progress.submittedOrders} 笔 · 已撤 ${progress.cancelledOrders} 笔`;
}

/**
 * The shared object remains readable after an AbortSignal rejects the running ladder promise.
 */
export function createLadderProgress() {
  return {
    submittedOrders: 0,
    cancelledOrders: 0,
  };
}

export function recordLadderSubmittedOrder(progress) {
  assertLadderProgress(progress);
  progress.submittedOrders += 1;
}

export function recordLadderCancelledOrder(progress) {
  assertLadderProgress(progress);
  progress.cancelledOrders += 1;
}

export function formatStoppedLadderProgress(label, progress) {
  assertLadderLabel(label);
  return `${label}已停止 · ${formatLadderProgressCounts(progress)}`;
}

export function formatInterruptedLadderProgress(label, reason, progress) {
  assertLadderLabel(label);
  assertLadderMessage(reason);
  return `${label}已中止：${reason} · ${formatLadderProgressCounts(progress)}`;
}

export function formatFailedLadderProgress(label, message, progress) {
  assertLadderLabel(label);
  assertLadderMessage(message);
  return `${label}失败：${message} · ${formatLadderProgressCounts(progress)}`;
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
    throw new Error('Invalid completed ladder total');
  }
  if (completedOrders !== totalOrders) {
    throw new Error('Completed ladder progress mismatch');
  }
  const cancelledText = progress.cancelledOrders > 0
    ? ` · 已撤 ${progress.cancelledOrders} 笔`
    : '';
  return `${label}已完成 · 已挂 ${completedOrders}/${totalOrders} 笔${cancelledText}`;
}
