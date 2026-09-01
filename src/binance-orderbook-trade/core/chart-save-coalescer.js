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

function readTradingViewDrawingToolName(api, drawingId) {
  const shape = api.activeChart?.().getShapeById?.(String(drawingId));
  // The current Binance runtime exposes the public line data source here;
  // avoid coupling the userscript to TradingView's private `_source` field.
  return shape?.lineDataSource?.()?.toolname || null;
}

/**
 * Binance schedules a complete chart serialization 100ms after every broker
 * drawing event. A submit capture is armed by our own button click, but it does
 * not replace saveChart until the matching LineToolOrder event arrives. The
 * wrapper is restored after that short event burst, while only the final
 * cumulative submit snapshot is replayed at the end of the ladder round.
 */
export function createTradingViewContinuousSaveController(
  api,
  {
    settleQuietMs = 120,
    maxWaitMs = 400,
    submitEventDiscoveryMs = 250,
    getDrawingToolName = readTradingViewDrawingToolName,
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
  if (!Number.isFinite(submitEventDiscoveryMs) || submitEventDiscoveryMs < 0) {
    throw new Error('订单线事件等待时间无效');
  }
  if (typeof getDrawingToolName !== 'function') {
    throw new Error('订单线类型解析依赖异常');
  }

  const sessionSaveChart = api.saveChart;
  let activeBurst = null;
  let activeRound = null;
  let activeSubmitCapture = null;
  let removeEventCount = 0;
  let orderEventCount = 0;
  let saveRequestCount = 0;
  let fullSaveCount = 0;
  let deferredSubmitSaveCount = 0;
  let sequence = 0;
  let stopped = false;

  const getStats = () => ({
    deferredSubmitSaveCount,
    fullSaveCount,
    orderEventCount,
    removeEventCount,
    saveRequestCount,
  });
  const finishSubmitCapture = (capture, status) => {
    if (!capture || capture.settled) return;
    if (capture.discoveryTimer !== null) clearTimeoutFn(capture.discoveryTimer);
    capture.discoveryTimer = null;
    capture.settled = true;
    capture.status = status;
    if (activeSubmitCapture === capture) activeSubmitCapture = null;
    capture.resolve({ matched: capture.matched, status });
  };

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
    const saveChartWasReplaced = api.saveChart !== burst.wrapper;
    if (!saveChartWasReplaced) {
      restoreSaveChartMethod(
        api,
        burst.wrapper,
        burst.originalSaveChart,
        burst.originalDescriptor,
      );
    }
    try {
      if (!burst.pendingSave) return undefined;
      if (saveChartWasReplaced) {
        if (activeRound?.pendingSave) activeRound.pendingSave = null;
        fullSaveCount += 1;
        return burst.originalSaveChart.apply(
          burst.pendingSave.thisValue,
          burst.pendingSave.args,
        );
      }
      if (burst.deferToRound && activeRound) {
        activeRound.pendingSave = burst.pendingSave;
        deferredSubmitSaveCount += 1;
        return undefined;
      }
      if (activeRound?.pendingSave) activeRound.pendingSave = null;
      fullSaveCount += 1;
      return burst.originalSaveChart.apply(
        burst.pendingSave.thisValue,
        burst.pendingSave.args,
      );
    } finally {
      if (burst.submitCapture) {
        finishSubmitCapture(
          burst.submitCapture,
          saveChartWasReplaced ? 'save-chart-replaced' : 'captured',
        );
      }
    }
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
      deferToRound: false,
      originalDescriptor,
      originalSaveChart,
      pendingSave: null,
      settleTimer: null,
      submitCapture: null,
      wrapper: null,
    };
    burst.wrapper = function continuousSaveBurstWrapper(...args) {
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
  const flushRoundPendingSave = () => {
    const pendingSave = activeRound?.pendingSave || null;
    if (!pendingSave) return undefined;
    activeRound.pendingSave = null;
    fullSaveCount += 1;
    return api.saveChart.apply(pendingSave.thisValue, pendingSave.args);
  };
  const handleDrawingEvent = (drawingId, eventType) => {
    if (stopped || IGNORED_DRAWING_EVENT_TYPES.has(eventType)) return;
    if (eventType === 'remove') {
      removeEventCount += 1;
      if (activeBurst?.deferToRound) flushActiveBurst();
      const burst = startBurst();
      if (burst) scheduleBurstSettle(burst);
      return;
    }

    const capture = activeSubmitCapture;
    if (!capture || capture.settled) return;
    let toolName = null;
    try {
      toolName = getDrawingToolName(api, drawingId);
    } catch {
      return;
    }
    if (toolName !== 'LineToolOrder') return;

    orderEventCount += 1;
    capture.matched = true;
    if (capture.discoveryTimer !== null) clearTimeoutFn(capture.discoveryTimer);
    capture.discoveryTimer = null;
    if (activeBurst && !activeBurst.deferToRound) flushActiveBurst();
    const burst = startBurst();
    if (!burst) {
      finishSubmitCapture(capture, 'save-chart-busy');
      return;
    }
    burst.deferToRound = true;
    burst.submitCapture = capture;
    scheduleBurstSettle(burst);
  };
  api.subscribe('drawing_event', handleDrawingEvent);

  return {
    getStats,
    beginRound() {
      if (stopped) throw new Error('连续图表保存控制器已停止');
      if (activeRound) throw new Error('已有图表保存轮次正在执行');
      if (activeSubmitCapture) throw new Error('上一笔订单线捕获尚未结束');
      flushActiveBurst();
      sequence += 1;
      activeRound = { id: sequence, pendingSave: null };
      return activeRound;
    },
    beginSubmitCapture(round) {
      if (stopped) throw new Error('连续图表保存控制器已停止');
      if (!activeRound || round !== activeRound) {
        throw new Error('图表保存轮次不匹配');
      }
      if (activeSubmitCapture) throw new Error('已有订单线保存捕获正在执行');
      let resolve;
      const promise = new Promise((settle) => {
        resolve = settle;
      });
      sequence += 1;
      const capture = {
        discoveryTimer: null,
        id: sequence,
        matched: false,
        promise,
        resolve,
        settled: false,
        status: null,
      };
      activeSubmitCapture = capture;
      capture.discoveryTimer = setTimeoutFn(
        () => finishSubmitCapture(capture, 'no-order-event'),
        submitEventDiscoveryMs,
      );
      return capture;
    },
    async completeSubmitCapture(capture) {
      if (!capture || capture !== activeSubmitCapture) {
        if (capture?.settled) return { matched: capture.matched, status: capture.status };
        throw new Error('订单线保存捕获不匹配');
      }
      return await capture.promise;
    },
    endRound(round) {
      if (!activeRound || round !== activeRound) {
        throw new Error('结束的图表保存轮次不匹配');
      }
      if (activeSubmitCapture) {
        throw new Error('结束图表保存轮次时仍有订单线捕获');
      }
      flushActiveBurst();
      const pendingSave = activeRound.pendingSave;
      activeRound = null;
      if (pendingSave) {
        fullSaveCount += 1;
        api.saveChart.apply(pendingSave.thisValue, pendingSave.args);
      }
      return getStats();
    },
    flush() {
      flushActiveBurst();
      if (activeSubmitCapture) finishSubmitCapture(activeSubmitCapture, 'flushed');
      return flushRoundPendingSave();
    },
    stop() {
      if (stopped) throw new Error('连续图表保存控制器已停止');
      stopped = true;
      api.unsubscribe('drawing_event', handleDrawingEvent);
      let cleanupError = null;
      try {
        flushActiveBurst();
      } catch (error) {
        cleanupError = error;
      }
      if (activeSubmitCapture) finishSubmitCapture(activeSubmitCapture, 'stopped');
      try {
        flushRoundPendingSave();
      } catch (error) {
        cleanupError ||= error;
      }
      activeRound = null;
      if (cleanupError) throw cleanupError;
      return getStats();
    },
  };
}

/**
 * A native bulk cancellation can emit many drawing removals over several short
 * bursts. Removal-triggered saves are held until the lifecycle finishes. Saves
 * outside a burst still run synchronously and supersede older held snapshots.
 */
export function createTradingViewRemovalSaveController(
  api,
  {
    settleQuietMs = 140,
    maxWaitMs = 600,
    eventDiscoveryMs = 250,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
  validateTradingViewApi(api);
  if (!Number.isFinite(settleQuietMs) || settleQuietMs <= 0) {
    throw new Error('删除事件保存合并静默时间无效');
  }
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < settleQuietMs) {
    throw new Error('删除事件保存合并最长等待时间无效');
  }
  if (!Number.isFinite(eventDiscoveryMs) || eventDiscoveryMs < 0) {
    throw new Error('删除事件发现时间无效');
  }

  const sessionSaveChart = api.saveChart;
  const sessionDescriptor = Object.getOwnPropertyDescriptor(api, 'saveChart');
  let activeBurst = null;
  let controllerError = null;
  let discoveryTimer = null;
  let finished = false;
  let fullSaveCount = 0;
  let pendingFinalSave = null;
  let removeEventCount = 0;
  let saveRequestCount = 0;
  let synchronousSaveCount = 0;
  let firstRemoveResolve;
  const firstRemove = new Promise((resolve) => {
    firstRemoveResolve = resolve;
  });

  const getStats = () => ({
    fullSaveCount,
    removeEventCount,
    saveRequestCount,
    synchronousSaveCount,
  });
  const monitoredSaveChart = function monitoredRemovalSessionSaveChart(...args) {
    synchronousSaveCount += 1;
    pendingFinalSave = null;
    return sessionSaveChart.apply(this, args);
  };
  const clearBurstTimers = (burst) => {
    if (burst.settleTimer !== null) clearTimeoutFn(burst.settleTimer);
    if (burst.maxWaitTimer !== null) clearTimeoutFn(burst.maxWaitTimer);
    burst.settleTimer = null;
    burst.maxWaitTimer = null;
  };
  const finishBurst = () => {
    const burst = activeBurst;
    if (!burst) return;
    clearBurstTimers(burst);
    activeBurst = null;
    if (api.saveChart !== burst.wrapper) {
      controllerError ||= new Error('图表保存接口在删除事件合并期间发生变化');
      pendingFinalSave = null;
      burst.resolve();
      return;
    }
    restoreSaveChartMethod(
      api,
      burst.wrapper,
      burst.originalSaveChart,
      burst.originalDescriptor,
    );
    if (burst.pendingSave) pendingFinalSave = burst.pendingSave;
    burst.resolve();
  };
  const scheduleBurstSettle = (burst) => {
    if (burst.settleTimer !== null) clearTimeoutFn(burst.settleTimer);
    burst.settleTimer = setTimeoutFn(finishBurst, settleQuietMs);
  };
  const startBurst = () => {
    if (activeBurst) return activeBurst;
    if (api.saveChart !== monitoredSaveChart) {
      controllerError ||= new Error('图表保存接口正被其他操作占用');
      return null;
    }
    let resolve;
    const settled = new Promise((settle) => {
      resolve = settle;
    });
    const burst = {
      maxWaitTimer: null,
      originalDescriptor: Object.getOwnPropertyDescriptor(api, 'saveChart'),
      originalSaveChart: api.saveChart,
      pendingSave: null,
      resolve,
      settleTimer: null,
      settled,
      wrapper: null,
    };
    burst.wrapper = function removalSaveBurstWrapper(...args) {
      saveRequestCount += 1;
      burst.pendingSave = { thisValue: this, args };
    };
    api.saveChart = burst.wrapper;
    if (api.saveChart !== burst.wrapper) {
      throw new Error('图表保存接口无法启用删除事件合并');
    }
    activeBurst = burst;
    burst.maxWaitTimer = setTimeoutFn(finishBurst, maxWaitMs);
    return burst;
  };
  const handleDrawingEvent = (_drawingId, eventType) => {
    if (finished || eventType !== 'remove') return;
    removeEventCount += 1;
    if (removeEventCount === 1) firstRemoveResolve();
    try {
      const burst = startBurst();
      if (burst) scheduleBurstSettle(burst);
    } catch (error) {
      controllerError ||= error;
    }
  };

  api.subscribe('drawing_event', handleDrawingEvent);
  try {
    api.saveChart = monitoredSaveChart;
    if (api.saveChart !== monitoredSaveChart) {
      throw new Error('图表保存接口无法启用删除事件监视');
    }
  } catch (error) {
    api.unsubscribe('drawing_event', handleDrawingEvent);
    throw error;
  }

  return {
    getStats,
    async finish() {
      if (finished) throw new Error('删除事件保存合并已结束');

      if (removeEventCount === 0 && eventDiscoveryMs > 0) {
        await Promise.race([
          firstRemove,
          new Promise((resolve) => {
            discoveryTimer = setTimeoutFn(resolve, eventDiscoveryMs);
          }),
        ]);
      }
      if (discoveryTimer !== null) clearTimeoutFn(discoveryTimer);
      discoveryTimer = null;
      if (activeBurst) await activeBurst.settled;

      finished = true;
      api.unsubscribe('drawing_event', handleDrawingEvent);
      if (api.saveChart === monitoredSaveChart) {
        restoreSaveChartMethod(
          api,
          monitoredSaveChart,
          sessionSaveChart,
          sessionDescriptor,
        );
      } else {
        controllerError ||= new Error('图表保存接口在删除事件监视期间发生变化');
        pendingFinalSave = null;
      }
      if (pendingFinalSave) {
        fullSaveCount += 1;
        sessionSaveChart.apply(pendingFinalSave.thisValue, pendingFinalSave.args);
      }
      if (controllerError) throw controllerError;
      return getStats();
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
