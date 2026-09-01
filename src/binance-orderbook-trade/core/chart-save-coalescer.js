const IGNORED_DRAWING_EVENT_TYPES = new Set(['click', 'move']);

function validateTradingViewApi(api) {
  if (!api || typeof api !== 'object') {
    throw new Error('图表接口不可用');
  }
  if (typeof api.saveChart !== 'function') {
    throw new Error('图表保存接口不可用');
  }
  if (typeof api.subscribe !== 'function' || typeof api.unsubscribe !== 'function') {
    throw new Error('图表事件接口不可用');
  }
}

function restoreSaveChartMethod(api, wrapper, originalSaveChart, originalDescriptor) {
  if (api.saveChart !== wrapper) {
    throw new Error('图表保存接口在操作期间发生变化');
  }
  if (originalDescriptor) {
    Object.defineProperty(api, 'saveChart', originalDescriptor);
  } else {
    delete api.saveChart;
  }
  if (api.saveChart !== originalSaveChart) {
    throw new Error('图表保存接口未能恢复');
  }
}

/**
 * Listen throughout a continuous-close session, but replace saveChart only for
 * a short window opened by a remove drawing event. Unrelated chart saves keep
 * their original synchronous path, while consecutive order-line removals replay
 * only their final cumulative snapshot.
 */
export function createTradingViewRemoveSaveBurstController(
  api,
  {
    settleQuietMs = 120,
    maxWaitMs = 400,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  validateTradingViewApi(api);
  if (!Number.isFinite(settleQuietMs) || settleQuietMs <= 0) {
    throw new Error('图表保存合并静默时间无效');
  }
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < settleQuietMs) {
    throw new Error('图表保存合并最长等待时间无效');
  }

  const sessionSaveChart = api.saveChart;
  let activeBurst = null;
  let removeEventCount = 0;
  let saveRequestCount = 0;
  let fullSaveCount = 0;
  let stopped = false;

  const clearBurstTimers = (burst) => {
    if (burst.settleTimer !== null) clearTimeoutFn(burst.settleTimer);
    if (burst.maxWaitTimer !== null) clearTimeoutFn(burst.maxWaitTimer);
    burst.settleTimer = null;
    burst.maxWaitTimer = null;
  };
  const flushActiveBurst = () => {
    const burst = activeBurst;
    if (!burst) return undefined;
    clearBurstTimers(burst);
    activeBurst = null;
    restoreSaveChartMethod(
      api,
      burst.wrapper,
      burst.originalSaveChart,
      burst.originalDescriptor,
    );
    if (!burst.pendingSave) return undefined;
    fullSaveCount += 1;
    return burst.originalSaveChart.apply(
      burst.pendingSave.thisValue,
      burst.pendingSave.args,
    );
  };
  const scheduleBurstSettle = (burst) => {
    if (burst.settleTimer !== null) clearTimeoutFn(burst.settleTimer);
    burst.settleTimer = setTimeoutFn(flushActiveBurst, settleQuietMs);
  };
  const startBurst = () => {
    if (activeBurst || api.saveChart !== sessionSaveChart) return activeBurst;
    const originalSaveChart = api.saveChart;
    const originalDescriptor = Object.getOwnPropertyDescriptor(api, 'saveChart');
    const burst = {
      maxWaitTimer: null,
      originalDescriptor,
      originalSaveChart,
      pendingSave: null,
      settleTimer: null,
      wrapper: null,
    };
    burst.wrapper = function removeSaveBurstWrapper(...args) {
      saveRequestCount += 1;
      burst.pendingSave = { thisValue: this, args };
      return undefined;
    };
    api.saveChart = burst.wrapper;
    if (api.saveChart !== burst.wrapper) {
      throw new Error('图表保存接口无法启用删除事件合并');
    }
    activeBurst = burst;
    burst.maxWaitTimer = setTimeoutFn(flushActiveBurst, maxWaitMs);
    return burst;
  };
  const handleDrawingEvent = (_drawingId, eventType) => {
    if (stopped || eventType !== 'remove') return;
    removeEventCount += 1;
    const burst = startBurst();
    if (burst) scheduleBurstSettle(burst);
  };
  api.subscribe('drawing_event', handleDrawingEvent);

  return {
    flush: flushActiveBurst,
    stop() {
      if (stopped) throw new Error('图表删除事件保存合并器已停止');
      stopped = true;
      api.unsubscribe('drawing_event', handleDrawingEvent);
      flushActiveBurst();
      return { fullSaveCount, removeEventCount, saveRequestCount };
    },
  };
}

/**
 * Binance schedules one complete chart save for every broker drawing event.
 * The last request contains the cumulative final state, so one burst can be
 * persisted with only its final request after all matching events arrive.
 */
export async function coalesceTradingViewDrawingSaves(
  api,
  action,
  {
    eventDiscoveryTimeoutMs = 800,
    settleQuietMs = 50,
    timeoutMs = 1800,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  validateTradingViewApi(api);
  if (typeof action !== 'function') throw new Error('图表操作不可用');
  if (!Number.isFinite(eventDiscoveryTimeoutMs) || eventDiscoveryTimeoutMs < 0) {
    throw new Error('图表事件等待时间无效');
  }
  if (!Number.isFinite(settleQuietMs) || settleQuietMs <= 0) {
    throw new Error('图表保存稳定等待时间无效');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('图表保存超时时间无效');
  }

  const originalSaveChart = api.saveChart;
  const originalDescriptor = Object.getOwnPropertyDescriptor(api, 'saveChart');
  let drawingEventCount = 0;
  let saveRequestCount = 0;
  let pendingSave = null;
  let actionFinished = false;
  let eventStartResolve;
  let settleResolve;
  let settleReject;
  let eventDiscoveryTimeout = null;
  let settleQuietTimeout = null;
  let waitTimeout = null;
  let subscribed = false;

  const drawingEventsStarted = new Promise((resolve) => {
    eventStartResolve = resolve;
  });
  const burstSettled = new Promise((resolve, reject) => {
    settleResolve = resolve;
    settleReject = reject;
  });
  const scheduleSettleIfReady = () => {
    if (settleQuietTimeout !== null) {
      clearTimeoutFn(settleQuietTimeout);
      settleQuietTimeout = null;
    }
    if (
      !actionFinished
      || drawingEventCount === 0
      || saveRequestCount < drawingEventCount
    ) {
      return;
    }
    settleQuietTimeout = setTimeoutFn(() => {
      settleQuietTimeout = null;
      settleResolve();
    }, settleQuietMs);
  };
  const handleDrawingEvent = (_drawingId, eventType) => {
    if (IGNORED_DRAWING_EVENT_TYPES.has(eventType)) return;
    drawingEventCount += 1;
    if (drawingEventCount === 1) eventStartResolve();
    scheduleSettleIfReady();
  };
  const saveChartWrapper = function coalescedSaveChart(...args) {
    saveRequestCount += 1;
    pendingSave = { thisValue: this, args };
    scheduleSettleIfReady();
  };

  api.subscribe('drawing_event', handleDrawingEvent);
  subscribed = true;
  try {
    api.saveChart = saveChartWrapper;
    if (api.saveChart !== saveChartWrapper) {
      throw new Error('图表保存接口无法临时接管');
    }
  } catch (error) {
    api.unsubscribe('drawing_event', handleDrawingEvent);
    throw error;
  }

  try {
    const actionResult = await action();
    actionFinished = true;
    scheduleSettleIfReady();

    if (drawingEventCount === 0 && eventDiscoveryTimeoutMs > 0) {
      // Binance changes the checkbox first and emits drawing events later.
      await Promise.race([
        drawingEventsStarted,
        new Promise((resolve) => {
          eventDiscoveryTimeout = setTimeoutFn(resolve, eventDiscoveryTimeoutMs);
        }),
      ]);
    }

    if (drawingEventCount > 0) {
      scheduleSettleIfReady();
      waitTimeout = setTimeoutFn(() => {
        if (saveRequestCount < drawingEventCount) {
          settleReject(new Error(
            `图表保存请求数量不一致：预期 ${drawingEventCount}，实际 ${saveRequestCount}`,
          ));
          return;
        }
        settleReject(new Error(
          `图表保存未在 ${timeoutMs} 毫秒内完成`,
        ));
      }, timeoutMs);
      await burstSettled;
    }

    api.unsubscribe('drawing_event', handleDrawingEvent);
    subscribed = false;

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
    if (eventDiscoveryTimeout !== null) clearTimeoutFn(eventDiscoveryTimeout);
    if (settleQuietTimeout !== null) clearTimeoutFn(settleQuietTimeout);
    if (waitTimeout !== null) clearTimeoutFn(waitTimeout);
    if (subscribed) api.unsubscribe('drawing_event', handleDrawingEvent);
    restoreSaveChartMethod(api, saveChartWrapper, originalSaveChart, originalDescriptor);
  }
}
