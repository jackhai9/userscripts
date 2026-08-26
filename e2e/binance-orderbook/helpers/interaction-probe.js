export async function installInteractionProbe(page, targetSelector) {
  await page.evaluate((selector) => {
    const panel = document.querySelector('#jh-binance-close-qty-multiplier-panel');
    const target = document.querySelector(selector);
    if (!panel || !target) throw new Error(`Interaction probe target is unavailable: ${selector}`);

    const state = {
      startedAt: null,
      firstFeedbackAt: null,
      longTasks: [],
      longAnimationFrames: [],
      baseline: {},
    };
    for (const button of panel.querySelectorAll('[data-ladder-action], [data-ladder-stop]')) {
      const key = button.getAttribute('data-ladder-action') || 'stop';
      const rect = button.getBoundingClientRect();
      state.baseline[key] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }

    target.addEventListener('click', () => {
      state.startedAt = performance.now();
    }, { capture: true, once: true });

    const mutationObserver = new MutationObserver(() => {
      if (state.startedAt !== null && state.firstFeedbackAt === null) {
        state.firstFeedbackAt = performance.now();
      }
    });
    mutationObserver.observe(panel, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'style'],
    });

    let longTaskObserver = null;
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver((list) => {
        state.longTasks.push(...list.getEntries().map((entry) => ({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
        })));
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    }

    let longAnimationFrameObserver = null;
    if (PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
      longAnimationFrameObserver = new PerformanceObserver((list) => {
        state.longAnimationFrames.push(...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
          blockingDuration: entry.blockingDuration,
          forcedStyleAndLayoutDuration: entry.scripts?.reduce(
            (total, script) => total + (script.forcedStyleAndLayoutDuration || 0),
            0
          ) || 0,
          scripts: entry.scripts?.map((script) => ({
            sourceURL: script.sourceURL,
            functionName: script.functionName,
            duration: script.duration,
          })) || [],
        })));
      });
      longAnimationFrameObserver.observe({ type: 'long-animation-frame', buffered: true });
    }

    window.__UI_INTERACTION_PROBE__ = {
      finish() {
        mutationObserver.disconnect();
        longTaskObserver?.disconnect();
        longAnimationFrameObserver?.disconnect();
        const current = {};
        for (const button of panel.querySelectorAll('[data-ladder-action], [data-ladder-stop]')) {
          const key = button.getAttribute('data-ladder-action') || 'stop';
          const rect = button.getBoundingClientRect();
          current[key] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
        return {
          firstFeedbackMs: state.startedAt !== null && state.firstFeedbackAt !== null
            ? state.firstFeedbackAt - state.startedAt
            : null,
          longTasks: state.longTasks.filter((entry) => (
            state.startedAt !== null && entry.startTime >= state.startedAt
          )),
          longAnimationFrames: state.longAnimationFrames.filter((entry) => (
            state.startedAt !== null && entry.startTime >= state.startedAt
          )),
          baseline: state.baseline,
          current,
        };
      },
    };
  }, targetSelector);
}

export async function finishInteractionProbe(page) {
  return page.evaluate(() => window.__UI_INTERACTION_PROBE__.finish());
}

export function assertResponsiveInteraction(expect, probe) {
  expect(probe.firstFeedbackMs).not.toBeNull();
  expect(probe.firstFeedbackMs).toBeLessThanOrEqual(200);
  expect(Math.max(0, ...probe.longTasks.map((entry) => entry.duration))).toBeLessThanOrEqual(200);
  expect(Math.max(0, ...probe.longAnimationFrames.map((entry) => entry.duration))).toBeLessThanOrEqual(200);
}

export function assertStableGeometry(expect, baseline, current) {
  for (const [key, before] of Object.entries(baseline)) {
    expect(current[key], `missing control geometry for ${key}`).toEqual(before);
  }
}
