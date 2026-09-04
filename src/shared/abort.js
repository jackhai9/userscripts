function getAbortReason(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw getAbortReason(signal);
}

export function waitForPromiseOrAbort(task, signal) {
  if (!signal) return Promise.resolve(task);
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, getAbortReason(signal));

    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(task).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}
