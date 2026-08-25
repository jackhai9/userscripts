export function remainingInteractionFeedbackMs({
  startedAtMs,
  nowMs,
  minimumMs,
}) {
  return Math.max(0, minimumMs - Math.max(0, nowMs - startedAtMs));
}

async function waitForRemainingFeedback({
  startedAtMs,
  minimumMs,
  now,
  delay,
}) {
  const remainingMs = remainingInteractionFeedbackMs({
    startedAtMs,
    nowMs: now(),
    minimumMs,
  });
  if (remainingMs > 0) await delay(remainingMs);
}

export function keepInteractionFeedbackVisible(task, options) {
  return Promise.resolve(task).then(
    async (value) => {
      await waitForRemainingFeedback(options);
      return value;
    },
    async (error) => {
      await waitForRemainingFeedback(options);
      throw error;
    },
  );
}
