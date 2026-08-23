export function resolveCancelDialogDecision({
  seenDialog,
  action,
  dialogVisible,
  nowMs,
  discoveryDeadlineMs,
  closeDeadlineMs,
}) {
  if (dialogVisible) {
    if (closeDeadlineMs !== null && nowMs >= closeDeadlineMs) {
      return 'dialog_not_closed';
    }
    return 'waiting';
  }
  if (seenDialog) return action === 'confirmed' ? 'confirmed' : 'cancelled';
  if (nowMs >= discoveryDeadlineMs) return 'not_found';
  return 'waiting';
}
