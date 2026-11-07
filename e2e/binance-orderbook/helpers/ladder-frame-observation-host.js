/**
 * Hold only the browser paint boundary; timers and document visibility retain
 * their normal semantics. Releasing queues callbacks onto the native scheduler.
 */
export function installFrameObservationHost(view) {
  const request = view.requestAnimationFrame.bind(view);
  const cancel = view.cancelAnimationFrame.bind(view);
  const queued = new Map();
  const scheduled = new Map();
  let held = false;
  let sequence = 1;
  function schedule(handle, callback) {
    scheduled.set(handle, request(timestamp => {
      scheduled.delete(handle);
      callback(timestamp);
    }));
  }
  view.requestAnimationFrame = callback => {
    const handle = sequence++;
    if (held) queued.set(handle, callback);
    else schedule(handle, callback);
    return handle;
  };
  view.cancelAnimationFrame = handle => {
    if (queued.delete(handle)) return;
    if (scheduled.has(handle)) {
      cancel(scheduled.get(handle));
      scheduled.delete(handle);
    }
  };
  return {
    hold() { held = true; },
    release() {
      held = false;
      for (const [handle, callback] of queued) schedule(handle, callback);
      queued.clear();
    },
    snapshot() { return { held, queued: queued.size, scheduled: scheduled.size }; },
  };
}
