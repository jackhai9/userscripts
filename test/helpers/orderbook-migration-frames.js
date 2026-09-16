/**
 * Supplies browser frame scheduling for an isolated JSDOM document. Callbacks
 * scheduled during a frame are deferred until the next explicit frame.
 */
export function createAnimationFrameBoundary(view) {
  const callbacks = new Map();
  let nextHandle = 1;
  view.requestAnimationFrame = (callback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  };
  view.cancelAnimationFrame = (handle) => callbacks.delete(handle);
  return {
    get pendingCount() {
      return callbacks.size;
    },
    runFrame(timestamp) {
      const handles = [...callbacks.keys()];
      for (const handle of handles) {
        if (!callbacks.has(handle)) continue;
        const callback = callbacks.get(handle);
        callbacks.delete(handle);
        callback(timestamp);
      }
    },
  };
}
