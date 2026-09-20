/** Simulate a background tab after the real userscript has loaded in the fixture. */
export async function installSimulatedVisibility(page) {
  await page.evaluate(() => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const pendingHiddenFrames = new Map();
    const resumedHiddenFrames = new Map();
    let nextHiddenFrame = 1_000_000;
    const state = {
      hidden: false,
      setHidden(hidden) {
        if (this.hidden === hidden) return;
        this.hidden = hidden;
        document.dispatchEvent(new Event('visibilitychange'));
        if (!hidden) {
          for (const [handle, callback] of pendingHiddenFrames) {
            pendingHiddenFrames.delete(handle);
            resumedHiddenFrames.set(handle, nativeRequestAnimationFrame(timestamp => {
              resumedHiddenFrames.delete(handle);
              callback(timestamp);
            }));
          }
        }
      },
    };
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden });
    window.requestAnimationFrame = callback => {
      if (!state.hidden) return nativeRequestAnimationFrame(callback);
      const handle = nextHiddenFrame++;
      pendingHiddenFrames.set(handle, callback);
      return handle;
    };
    window.cancelAnimationFrame = handle => {
      if (pendingHiddenFrames.delete(handle)) return;
      const resumedHandle = resumedHiddenFrames.get(handle);
      if (resumedHiddenFrames.has(handle)) {
        resumedHiddenFrames.delete(handle);
        nativeCancelAnimationFrame(resumedHandle);
        return;
      }
      nativeCancelAnimationFrame(handle);
    };
    window.__SIMULATED_VISIBILITY__ = state;
  });
}

export async function setSimulatedVisibility(page, hidden) {
  await page.evaluate(value => window.__SIMULATED_VISIBILITY__.setHidden(value), hidden);
}
