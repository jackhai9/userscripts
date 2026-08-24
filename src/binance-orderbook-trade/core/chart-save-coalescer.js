const IGNORED_DRAWING_EVENT_TYPES = new Set(['click', 'move']);

function validateTradingViewApi(api) {
  if (!api || typeof api !== 'object') {
    throw new Error('TradingView API is unavailable');
  }
  if (typeof api.saveChart !== 'function') {
    throw new Error('TradingView saveChart API is unavailable');
  }
  if (typeof api.subscribe !== 'function' || typeof api.unsubscribe !== 'function') {
    throw new Error('TradingView drawing-event subscription API is unavailable');
  }
}

function restoreSaveChartMethod(api, wrapper, originalSaveChart, originalDescriptor) {
  if (api.saveChart !== wrapper) {
    throw new Error('TradingView saveChart API changed during save coalescing');
  }
  if (originalDescriptor) {
    Object.defineProperty(api, 'saveChart', originalDescriptor);
  } else {
    delete api.saveChart;
  }
  if (api.saveChart !== originalSaveChart) {
    throw new Error('TradingView saveChart API was not restored');
  }
}

/**
 * Coalesces the full-chart saves that Binance schedules for one burst of
 * TradingView drawing events. Every intercepted save is a complete snapshot,
 * so the final request contains the cumulative state of the whole burst.
 */
export async function coalesceTradingViewDrawingSaves(
  api,
  action,
  {
    timeoutMs = 1800,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  validateTradingViewApi(api);
  if (typeof action !== 'function') throw new Error('Chart action is unavailable');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('TradingView save coalescing timeout is invalid');
  }

  const originalSaveChart = api.saveChart;
  const originalDescriptor = Object.getOwnPropertyDescriptor(api, 'saveChart');
  let drawingEventCount = 0;
  let saveRequestCount = 0;
  let pendingSave = null;
  let actionFinished = false;
  let waitResolve;
  let waitTimeout = null;
  let subscribed = false;

  const savesReady = new Promise((resolve) => {
    waitResolve = resolve;
  });
  const resolveIfReady = () => {
    if (actionFinished && saveRequestCount >= drawingEventCount) waitResolve();
  };
  const handleDrawingEvent = (_drawingId, eventType) => {
    if (!IGNORED_DRAWING_EVENT_TYPES.has(eventType)) drawingEventCount += 1;
  };
  const saveChartWrapper = function coalescedSaveChart(...args) {
    saveRequestCount += 1;
    pendingSave = { thisValue: this, args };
    resolveIfReady();
  };

  api.subscribe('drawing_event', handleDrawingEvent);
  subscribed = true;
  try {
    api.saveChart = saveChartWrapper;
    if (api.saveChart !== saveChartWrapper) {
      throw new Error('TradingView saveChart API is not writable');
    }
  } catch (error) {
    api.unsubscribe('drawing_event', handleDrawingEvent);
    throw error;
  }

  try {
    const actionResult = await action();
    api.unsubscribe('drawing_event', handleDrawingEvent);
    subscribed = false;
    actionFinished = true;
    resolveIfReady();

    if (drawingEventCount > saveRequestCount) {
      await Promise.race([
        savesReady,
        new Promise((_, reject) => {
          waitTimeout = setTimeoutFn(() => {
            reject(new Error(
              `Expected ${drawingEventCount} TradingView saveChart requests, received ${saveRequestCount}`,
            ));
          }, timeoutMs);
        }),
      ]);
    }

    if (pendingSave) {
      originalSaveChart.apply(pendingSave.thisValue, pendingSave.args);
    }
    return {
      actionResult,
      drawingEventCount,
      saveRequestCount,
      fullSaveCount: pendingSave ? 1 : 0,
    };
  } finally {
    if (waitTimeout !== null) clearTimeoutFn(waitTimeout);
    if (subscribed) api.unsubscribe('drawing_event', handleDrawingEvent);
    restoreSaveChartMethod(api, saveChartWrapper, originalSaveChart, originalDescriptor);
  }
}
