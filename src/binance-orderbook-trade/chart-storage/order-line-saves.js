const HOST_TOPICS = [
  'onAutoSaveNeeded', 'study_event', 'study_properties_changed',
  'layout_about_to_be_changed', 'layout_changed', 'drawing_event',
];
const STUDY_SAVE = /^\(\)=>\{(?<ready>[$\w]+)\.current&&(?<save>[$\w]+)\(\)\}$/;
const DRAWING_SAVE = /^\((?<id>[$\w]+),(?<type>[$\w]+)\)=>\{if\((?<ready>[$\w]+)\.current\)switch\(\k<type>\)\{case"click":case"move":return;default:(?<save>[$\w]+)\(\)\}\}$/;
const SOURCE_EXCERPT_LENGTH = 240;
/** Removal bursts of known order lines that bypass removeSource before the hook is considered broken. */
const MISSED_REMOVAL_LIMIT = 3;
/** Removals this close together count once, so one chart teardown cannot look like a broken hook. */
const MISSED_REMOVAL_BURST_MS = 1000;
const ORDER_TOOL = 'LineToolOrder';
/** Lookup failures are expected while a chart is replaced; repeated bursts mean the model API changed. */
const LOOKUP_ERROR_LIMIT = 3;
const LOOKUP_ERROR_BURST_MS = 5000;
/** TradingView's documented drawing_event types; a new one may carry order-line changes. */
const DRAWING_EVENT_TYPES = new Set([
  'click', 'move', 'remove', 'hide', 'show', 'create', 'properties_changed', 'points_changed',
]);
/** Binance subscribes in the same turn as widgetReady; a chart can take minutes to get there. */
export const ORDER_LINE_CONTRACT_CHECK_MS = 30000;
const ORDER_LINE_CONTRACT_CHECKS = 20;
const filteredApis = new WeakSet();

export function hasOrderLineSaveListener(api) {
  return filteredApis.has(api);
}

function sourceExcerpt(callback) {
  if (typeof callback !== 'function') return String(callback);
  return Function.prototype.toString.call(callback).slice(0, SOURCE_EXCERPT_LENGTH);
}

/**
 * The host binds these topics together on chart readiness. Its study and drawing
 * listeners use the same readiness flag and save function. Compare those names
 * across the callbacks instead of depending on a particular minifier output.
 * Only inspect the first complete batch. A different drawing handler may do more.
 * A complete batch whose callbacks no longer match is a contract break.
 */
function identifyHostSubscription(report) {
  let next = 0;
  let study;
  let studyCallback;
  let inspected = false;
  const identify = (event, callback) => {
    if (inspected) return false;
    if (event === HOST_TOPICS[0]) {
      next = 1;
      queueMicrotask(() => { next = 0; });
      return false;
    }
    if (!next || event !== HOST_TOPICS[next]) {
      next = 0;
      return false;
    }
    next++;
    if (event === 'study_properties_changed') {
      studyCallback = callback;
      study = typeof callback === 'function' && STUDY_SAVE.exec(Function.prototype.toString.call(callback))?.groups;
    }
    if (event !== 'drawing_event') return false;
    inspected = true;
    const drawing = typeof callback === 'function' && DRAWING_SAVE.exec(Function.prototype.toString.call(callback))?.groups;
    const matched = !!(study && drawing && study.ready === drawing.ready && study.save === drawing.save
      && new Set(Object.values(drawing)).size === 4);
    if (!matched) {
      report('listener-shape', `study: ${sourceExcerpt(studyCallback)} | drawing: ${sourceExcerpt(callback)}`);
    }
    return matched;
  };
  identify.inspected = () => inspected;
  return identify;
}

function chartModels(collection) {
  const models = [];
  const widgets = collection.getAll();
  if (!Array.isArray(widgets)) return null;
  for (const widget of widgets) {
    if (typeof widget?.hasModel !== 'function') return null;
    if (!widget.hasModel()) continue;
    const undoModel = typeof widget.model === 'function' && widget.model();
    const model = typeof undoModel?.model === 'function' && undoModel.model();
    if (typeof model?.getLineToolById !== 'function') return null;
    models.push(model);
  }
  return models;
}

const CHART_MODEL_SHAPE = 'Chart widgets no longer expose getAll() → hasModel/model().model().getLineToolById';

/** A drawing ID alone does not identify its chart in a multi-chart layout. */
function isLiveOrderLine(collection, id, report, noteLookupError) {
  try {
    const models = chartModels(collection);
    if (!models) {
      report('chart-model', CHART_MODEL_SHAPE);
      return false;
    }
    let found = false;
    for (const model of models) {
      const source = model.getLineToolById(id);
      if (!source) continue;
      if (source.toolname !== ORDER_TOOL) {
        // A renamed order tool would otherwise pass as a hand drawing with matched=1.
        if (/order/i.test(source.toolname)) report('order-tool-name', `Order line tool is now named ${source.toolname}`);
        return false;
      }
      found = true;
    }
    return found;
  } catch (error) {
    // A chart being replaced may no longer answer lookups. Keep its native save;
    // repeated failures are reported by noteLookupError.
    noteLookupError(error);
    return false;
  }
}

function removingOrderId(source, noteLookupError) {
  try {
    return source?.toolname === ORDER_TOOL && typeof source.id === 'function' ? source.id() : null;
  } catch (error) {
    // An unreadable source must still be removed and its native event delivered.
    noteLookupError(error);
    return null;
  }
}

/**
 * TradingView detaches the source before emitting remove, synchronously inside
 * removeSource. Capture its identity for that call only. A shared model prototype
 * also covers charts created later in this iframe. Nested removals shadow it.
 */
function trackRemovals(collection, report, noteLookupError) {
  const models = chartModels(collection);
  if (!models) {
    report('chart-model', CHART_MODEL_SHAPE);
    return null;
  }
  // No model yet: the frame check reports it if the chart stays unfiltered.
  if (!models.length) return null;
  let owner = Object.getPrototypeOf(models[0]);
  while (owner && !Object.hasOwn(owner, 'removeSource')) owner = Object.getPrototypeOf(owner);
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, 'removeSource');
  if (!descriptor?.writable || typeof descriptor.value !== 'function') {
    report('removal-hook', 'Chart model prototype no longer has a writable removeSource method');
    return null;
  }
  const removeSource = descriptor.value;
  let removing = null;
  Object.defineProperty(owner, 'removeSource', {
    ...descriptor,
    value: function (source) {
      const previous = removing;
      removing = removingOrderId(source, noteLookupError);
      try { return Reflect.apply(removeSource, this, arguments); }
      finally { removing = previous; }
    },
  });
  return id => removing != null && removing === id;
}

/** Returns a reader of whether Binance's save listener is currently filtered on this widget. */
function observeSubscriptions(api, stats, report, now, noteLookupError, onNativeSave) {
  const collection = api?._chartWidgetCollection;
  if (typeof collection?.getAll !== 'function' || typeof api.subscribe !== 'function'
    || typeof api.unsubscribe !== 'function') {
    report('api-shape', 'tradingViewApi no longer exposes _chartWidgetCollection.getAll, subscribe and unsubscribe');
    return null;
  }
  const { subscribe, unsubscribe } = api;
  const identify = identifyHostSubscription(report);
  let hostCallback;
  let listener;
  let registrations = 0;
  let isRemoving;
  // Order lines seen through property changes; their removals must pass through removeSource.
  const liveOrders = new Set();
  let capturedRemovals = 0;
  let missedRemovals = 0;
  let lastMissedRemovalAt = -Infinity;
  api.subscribe = function (event, callback) {
    if (!hostCallback && (this !== api || event !== 'drawing_event')) {
      let accepted = false;
      try {
        const result = Reflect.apply(subscribe, this, arguments);
        accepted = this === api;
        return result;
      } finally {
        identify(accepted ? event : null, callback);
      }
    }
    if (!hostCallback && identify(event, callback)) {
      hostCallback = callback;
      try {
        isRemoving = trackRemovals(collection, report, noteLookupError);
      } catch {
        // Keep this widget native if its model was disposed during installation;
        // the frame check reports it if the chart stays unfiltered.
        return Reflect.apply(subscribe, this, arguments);
      }
    }
    if (this !== api || event !== 'drawing_event' || callback !== hostCallback || !isRemoving) {
      return Reflect.apply(subscribe, this, arguments);
    }
    if (!listener) {
      listener = function (id, type) {
        if (!DRAWING_EVENT_TYPES.has(type)) report('event-type', `Unknown drawing_event type: ${String(type)}`);
        // Order lines are only known to emit property changes; point changes would bypass the filter.
        if (type === 'points_changed' && isLiveOrderLine(collection, id, report, noteLookupError)) {
          report('order-event-type', 'Order lines now emit points_changed, which still saves the whole chart');
        }
        if (type === 'properties_changed' && isLiveOrderLine(collection, id, report, noteLookupError)) {
          liveOrders.add(id);
          stats.skipped++;
          return;
        }
        if (type === 'remove') {
          if (isRemoving(id)) {
            capturedRemovals++;
            liveOrders.delete(id);
            stats.skipped++;
            return;
          }
          if (liveOrders.delete(id) && capturedRemovals === 0) {
            const at = now();
            if (at - lastMissedRemovalAt >= MISSED_REMOVAL_BURST_MS && ++missedRemovals === MISSED_REMOVAL_LIMIT) {
              report('removal-capture', `${missedRemovals} separate order-line removal bursts were emitted outside removeSource`);
            }
            lastMissedRemovalAt = at;
          }
        }
        // Binance ignores click and move; every other event schedules a native save.
        if (type !== 'click' && type !== 'move') onNativeSave();
        return Reflect.apply(callback, this, arguments);
      };
    }
    const result = subscribe.call(this, event, listener);
    if (registrations++ === 0) {
      filteredApis.add(api);
      stats.matched++;
    }
    return result;
  };
  api.unsubscribe = function (event, callback) {
    if (this === api && event === 'drawing_event' && callback === hostCallback && registrations > 0) {
      const result = unsubscribe.call(this, event, listener);
      if (--registrations === 0) filteredApis.delete(api);
      return result;
    }
    return Reflect.apply(unsubscribe, this, arguments);
  };
  return () => {
    if (registrations > 0) return null;
    // Binance unsubscribed a recognized listener: nothing saves, nothing to filter.
    if (hostCallback && isRemoving) return null;
    if (hostCallback) return 'removal-hook';
    // A mismatched batch was already reported when it was inspected.
    if (identify.inspected()) return null;
    return 'subscription-batch';
  };
}

const UNFILTERED_DETAIL = {
  'removal-hook': 'Save listener recognized, but order removals could not be tracked on this chart',
  'subscription-batch': `Host subscription batch ${HOST_TOPICS.join(' → ')} was not observed`,
};

/**
 * Binance loads a same-origin bootstrap document, then rewrites it. Arm the
 * widgetReady callback after document.open clears old listeners but before the
 * host can subscribe. The final iframe load alone would miss the subscription.
 *
 * The filter depends on that bootstrap, the host's subscription batch and
 * TradingView's chart model. Any mismatch keeps Binance's native save and is
 * reported through `onContractBreak` once per reason, so the dependency can be
 * updated instead of silently losing the filter. Mismatches visible at
 * installation are reported immediately. A recurring frame check covers the
 * ones that only show as absence: an API that never reached widgetReady, or a
 * widget whose save listener stayed unfiltered after its readiness.
 */
export function observeOrderLineSaves(document, { onContractBreak, setTimeout, now, onNativeSave }) {
  if ([onContractBreak, setTimeout, now, onNativeSave].some(value => typeof value !== 'function')) {
    throw new Error('Order-line saves require a contract break handler, setTimeout, now and onNativeSave');
  }
  const stats = { matched: 0, skipped: 0 };
  const breaks = [];
  const reported = new Set();
  let lookupErrorBursts = 0;
  let lastLookupErrorAt = -Infinity;
  const unfilteredReaders = new WeakMap();
  const frameStates = new WeakMap();
  // Keyed by window: a later load of the same frame must still see a pending callback.
  const pendingReady = new WeakSet();

  /**
   * The native save keeps running; this only makes the broken dependency visible.
   * Reports run inside TradingView callbacks, so the handler is deferred: a failing
   * handler surfaces as its own error without dropping the event being delivered.
   */
  function report(reason, detail) {
    if (reported.has(reason)) return;
    reported.add(reason);
    const entry = Object.freeze({ reason, detail });
    breaks.push(entry);
    queueMicrotask(() => onContractBreak(entry));
  }

  function noteLookupError(error) {
    const at = now();
    if (at - lastLookupErrorAt >= LOOKUP_ERROR_BURST_MS && ++lookupErrorBursts === LOOKUP_ERROR_LIMIT) {
      report('lookup-error', `${LOOKUP_ERROR_LIMIT} separate bursts of chart lookup failures, last: ${error?.name}: ${String(error?.message).slice(0, 160)}`);
    }
    lastLookupErrorAt = at;
  }

  /**
   * Judges one frame load. The same API must be seen on two consecutive ticks,
   * a widgetReady callback still pending means the chart is not ready yet (chart
   * storage can delay it for minutes), and a widget is judged one full tick after
   * its readiness, so Binance's subscriptions have time to arrive. A newer load
   * of the same frame supersedes this check and restarts its tick budget.
   */
  function checkFrame(frame, state) {
    let previousApi = null;
    let readyApi = null;
    let renderedBefore = false;
    let remaining = ORDER_LINE_CONTRACT_CHECKS;
    const tick = () => {
      if (!frame.isConnected || frameStates.get(frame) !== state) return;
      const api = frame.contentWindow?.tradingViewApi ?? null;
      // A drawn chart means TradingView is ready, so a missing API or callback is no longer a slow start.
      const rendered = state.bootstrapFrame && Boolean(frame.contentDocument?.querySelector('canvas'));
      const renderedTwice = rendered && renderedBefore;
      renderedBefore = rendered;
      if (!api && renderedTwice) {
        report('bootstrap', 'TradingView drew the chart, but the frame never published tradingViewApi');
        return;
      }
      if (api && api === previousApi) {
        if (!state.bootstrapFrame) {
          report('bootstrap', `Chart API frame no longer matches iframe#tradingview_* inside .chart-widget-root (id: ${frame.id || 'none'})`);
          return;
        }
        const readUnfiltered = unfilteredReaders.get(api);
        if (readUnfiltered !== undefined && api === readyApi) {
          // null: the API shape was already reported at widgetReady.
          const reason = readUnfiltered?.();
          if (reason) report(reason, UNFILTERED_DETAIL[reason]);
          return;
        }
        if (readUnfiltered !== undefined) readyApi = api;
        else if (!pendingReady.has(frame.contentWindow)) {
          report('bootstrap', 'tradingViewApi exists but the innerWindowLoad → widgetReady hook never ran');
          return;
        } else if (renderedTwice) {
          report('bootstrap', 'TradingView drew the chart, but widgetReady never called back');
          return;
        }
      }
      previousApi = api;
      if (--remaining > 0) setTimeout(tick, ORDER_LINE_CONTRACT_CHECK_MS);
    };
    setTimeout(tick, ORDER_LINE_CONTRACT_CHECK_MS);
  }

  const isChartFrame = frame => frame.id.startsWith('tradingview_') && Boolean(frame.closest('.chart-widget-root'));
  const crossOrigin = frame => report('bootstrap', `TradingView frame ${frame.id} is no longer same-origin`);

  document.addEventListener('load', ({ target: frame }) => {
    if (frame.tagName !== 'IFRAME') return;
    if (!frame.contentDocument) {
      if (isChartFrame(frame)) crossOrigin(frame);
      return;
    }
    // Every same-origin frame is checked, so a chart frame that stopped matching is still noticed.
    const state = { bootstrapFrame: isChartFrame(frame) };
    frameStates.set(frame, state);
    checkFrame(frame, state);
    if (!state.bootstrapFrame) return;
    frame.addEventListener('load', () => queueMicrotask(() => {
      if (!frame.contentDocument) {
        crossOrigin(frame);
        return;
      }
      const win = frame.contentWindow;
      win.addEventListener('innerWindowLoad', () => {
        if (typeof win.widgetReady !== 'function') {
          report('bootstrap', 'TradingView bootstrap no longer defines widgetReady at innerWindowLoad');
          return;
        }
        pendingReady.add(win);
        win.widgetReady(() => {
          pendingReady.delete(win);
          const api = win.tradingViewApi;
          if (!api) {
            report('bootstrap', 'tradingViewApi is missing when widgetReady runs');
            return;
          }
          if (unfilteredReaders.has(api)) return;
          unfilteredReaders.set(api, observeSubscriptions(api, stats, report, now, noteLookupError, onNativeSave));
        });
      }, { capture: true, once: true });
    }), { once: true });
  }, true);
  return () => ({ ...stats, breaks: [...breaks] });
}
