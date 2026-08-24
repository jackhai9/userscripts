export function resolveCancelDialogDecision({
  seenDialog,
  action,
  dialogVisible,
  aborted,
  nowMs,
  discoveryDeadlineMs,
}) {
  if (aborted) return 'aborted';
  if (dialogVisible) return 'waiting';
  if (seenDialog) return action === 'confirmed' ? 'confirmed' : 'cancelled';
  if (nowMs >= discoveryDeadlineMs) return 'not_found';
  return 'waiting';
}
