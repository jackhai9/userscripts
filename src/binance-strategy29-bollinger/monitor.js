import {
  applyBollingerAlertTaskFailure,
  detectBollingerSignals,
} from './core/bearish-bollinger-pattern.js';
import {
  createBollingerIntervalSession,
  createBollingerMarkerLayer,
  exportClosedTradingViewBars,
  findBearishBollingerChartTarget,
  isBearishBollingerChartTargetCurrent,
  reconcileBearishBollingerAlertWindow,
} from './dom/tradingview-bearish-alerts.js';


/** Keeps strategy lifecycle independent of trading UI and makes the host boundary testable. */
export function createBollingerMonitor({
  document, getCurrentSymbol, isFuturesTradingPage, isTradingViewDrawingMutationBusy,
  err, warn,
}) {
  let bearishBollingerAlertTask = null;
  let bearishBollingerAlertContext = null;
  let bollingerIntervalSession = null;
  const retiredBollingerLayers = new Set();

  function clearBearishBollingerAlertContext() {
    if (bearishBollingerAlertContext) {
      retiredBollingerLayers.add(bearishBollingerAlertContext.layer);
      bearishBollingerAlertContext = null;
    }
    return clearRetiredBollingerLayers();
  }

  function clearRetiredBollingerLayers() {
    if (isTradingViewDrawingMutationBusy()) return false;
    for (const layer of retiredBollingerLayers) {
      if (layer.clear()) retiredBollingerLayers.delete(layer);
    }
    return retiredBollingerLayers.size === 0;
  }

  function disposeBollingerIntervalSession() {
    if (bollingerIntervalSession) {
      bollingerIntervalSession.session.dispose();
      bollingerIntervalSession = null;
    }
  }

  function isBearishBollingerAlertContextCurrent(context) {
    return (
      bearishBollingerAlertContext === context
      && context.intervalSession === bollingerIntervalSession?.session
      && context.intervalSession.isCurrent(context.intervalRevision)
      && !document.hidden
      && isFuturesTradingPage()
      && !isTradingViewDrawingMutationBusy()
      && getCurrentSymbol() === context.routeSymbol
      && isBearishBollingerChartTargetCurrent(document, context.target)
    );
  }

  async function synchronizeBearishBollingerAlerts() {
    if (document.hidden || !isFuturesTradingPage()) return;
    const routeSymbol = getCurrentSymbol();
    if (!routeSymbol) return;

    let target;
    try {
      target = findBearishBollingerChartTarget(document, routeSymbol);
    } catch (error) {
      disposeBollingerIntervalSession();
      clearBearishBollingerAlertContext();
      err('Bollinger chart lookup failed for this sample:', error);
      return;
    }
    if (!target) {
      disposeBollingerIntervalSession();
      clearBearishBollingerAlertContext();
      return;
    }

    if (
      !bollingerIntervalSession
      || bollingerIntervalSession.chart !== target.chart
      || bollingerIntervalSession.routeSymbol !== routeSymbol
    ) {
      disposeBollingerIntervalSession();
      bollingerIntervalSession = {
        chart: target.chart,
        routeSymbol,
        session: createBollingerIntervalSession(target.chart),
      };
    }
    const intervalSession = bollingerIntervalSession.session;

    const contextMatches = bearishBollingerAlertContext
      && bearishBollingerAlertContext.target.chart === target.chart
      && bearishBollingerAlertContext.target.chartRoot === target.chartRoot
      && bearishBollingerAlertContext.target.tradingViewApi === target.tradingViewApi
      && bearishBollingerAlertContext.routeSymbol === routeSymbol
      && bearishBollingerAlertContext.resolution === target.resolution
      && bearishBollingerAlertContext.intervalSession === intervalSession
      && bearishBollingerAlertContext.intervalRevision === intervalSession.revision;
    if (!contextMatches) {
      if (!clearBearishBollingerAlertContext()) return;
      if (!intervalSession.isCurrent(intervalSession.revision) || isTradingViewDrawingMutationBusy()) return;
      bearishBollingerAlertContext = {
        routeSymbol,
        resolution: target.resolution,
        intervalSession,
        intervalRevision: intervalSession.revision,
        target,
        layer: createBollingerMarkerLayer(target, {
          canMutate: () => !isTradingViewDrawingMutationBusy(),
          onSaveError: (error) => err('Bollinger chart save failed:', error),
        }),
        failed: false,
        cleanupPending: false,
        lastProcessedClosedBarsWindowKey: null,
        lastProcessedClosedBarsContentSnapshot: null,
        lastProcessedSignals: null,
      };
    }

    if (isTradingViewDrawingMutationBusy() || !clearRetiredBollingerLayers()) return;

    const context = bearishBollingerAlertContext;
    if (context.cleanupPending) {
      context.layer.clear();
      context.cleanupPending = false;
    }
    if (context.failed || bearishBollingerAlertTask) return;
    const task = (async () => {
      const bars = await exportClosedTradingViewBars(context.target, context.intervalSession);
      if (!bars || !isBearishBollingerAlertContextCurrent(context)) return;
      if (bars.length === 0) return;
      const result = await reconcileBearishBollingerAlertWindow({
        bars,
        cachedWindowKey: context.lastProcessedClosedBarsWindowKey,
        cachedContentSnapshot: context.lastProcessedClosedBarsContentSnapshot,
        cachedSignals: context.lastProcessedSignals,
        detectSignals: detectBollingerSignals,
        renderSignals: (signals) => context.layer.render(signals, {
          isCurrent: () => isBearishBollingerAlertContextCurrent(context),
        }),
      });
      if (result.rendered && isBearishBollingerAlertContextCurrent(context)) {
        context.lastProcessedClosedBarsWindowKey = result.closedBarsWindowKey;
        context.lastProcessedClosedBarsContentSnapshot = result.closedBarsContentSnapshot;
        context.lastProcessedSignals = result.signals;
      }
    })();
    bearishBollingerAlertTask = task;
    task.catch((error) => {
      if (
        bearishBollingerAlertContext !== context
        || context.intervalSession !== bollingerIntervalSession?.session
        || context.intervalRevision !== context.intervalSession.revision
      ) return;
      const failureKind = applyBollingerAlertTaskFailure(context, error);
      if (failureKind === 'retry') {
        // TradingView can expose one feed-update race through exportData(). Keep the
        // already-rendered layer and retry the next poll instead of turning a transient
        // snapshot into a permanent failed context.
        warn('布林带形态预警本轮快照不一致，保留现有标记并等待下一次采样:', error);
        return;
      }
      err('布林带形态预警已停止:', error);
    }).finally(() => {
      if (bearishBollingerAlertTask === task) bearishBollingerAlertTask = null;
    });
  }

  function stopBearishBollingerAlertMonitor() {
    // Invalidate even while a trade/save owner defers physical marker removal.
    disposeBollingerIntervalSession();
    clearBearishBollingerAlertContext();
  }

  /** On-demand lifecycle diagnostics; never exports market data or mutates drawings. */
  function getBollingerAlertDiagnostics() {
    const context = bearishBollingerAlertContext;
    const session = bollingerIntervalSession?.session || null;
    const chart = bollingerIntervalSession?.chart || context?.target.chart || null;
    const nativeModelReady = chart ? chart.hasModel() : null;
    return {
      taskPending: bearishBollingerAlertTask !== null,
      contextPresent: context !== null,
      failed: context ? context.failed : null,
      cleanupPending: context ? context.cleanupPending : null,
      cachedSignalCount: context?.lastProcessedSignals === null || !context
        ? null : context.lastProcessedSignals.length,
      layerSize: context ? context.layer.size : null,
      markerSaveStats: context ? context.layer.saveStats : null,
      retiredCount: retiredBollingerLayers.size,
      sessionPresent: session !== null,
      sessionRevision: session ? session.revision : null,
      contextIntervalRevision: context ? context.intervalRevision : null,
      sessionMatchesContext: context && session ? context.intervalSession === session : null,
      sessionCurrent: session && nativeModelReady ? session.isCurrent(session.revision) : null,
      nativeModelReady,
      nativeDataReady: nativeModelReady ? chart.dataReady() : null,
      mutationBlocked: isTradingViewDrawingMutationBusy(),
    };
  }

  return Object.freeze({
    tick: synchronizeBearishBollingerAlerts,
    stop: stopBearishBollingerAlertMonitor,
    get diagnostics() { return getBollingerAlertDiagnostics(); },
  });
}
