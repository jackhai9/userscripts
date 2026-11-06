const HOST_TOPICS = [
  'onAutoSaveNeeded', 'study_event', 'study_properties_changed',
  'layout_about_to_be_changed', 'layout_changed', 'drawing_event',
];
const STUDY_SAVE = /^\(\)=>\{(?<ready>[$\w]+)\.current&&(?<save>[$\w]+)\(\)\}$/;
const DRAWING_SAVE = /^\((?<id>[$\w]+),(?<type>[$\w]+)\)=>\{if\((?<ready>[$\w]+)\.current\)switch\(\k<type>\)\{case"click":case"move":return;default:(?<save>[$\w]+)\(\)\}\}$/;
const filteredApis = new WeakSet();

export function hasOrderLineSaveListener(api) {
  return filteredApis.has(api);
}

/**
 * The host binds these topics together on chart readiness. Its study and drawing
 * listeners use the same readiness flag and save function. Compare those names
 * across the callbacks instead of depending on a particular minifier output.
 * Only inspect the first complete batch. A different drawing handler may do more.
 */
function identifyHostSubscription() {
  let next = 0;
  let study;
  let inspected = false;
  return (event, callback) => {
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
      study = typeof callback === 'function' && STUDY_SAVE.exec(Function.prototype.toString.call(callback))?.groups;
    }
    if (event !== 'drawing_event') return false;
    inspected = true;
    const drawing = typeof callback === 'function' && DRAWING_SAVE.exec(Function.prototype.toString.call(callback))?.groups;
    return !!(study && drawing && study.ready === drawing.ready && study.save === drawing.save
      && new Set(Object.values(drawing)).size === 4);
  };
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

/** A drawing ID alone does not identify its chart in a multi-chart layout. */
function isLiveOrderLine(collection, id) {
  try {
    const models = chartModels(collection);
    if (!models) return false;
    let found = false;
    for (const model of models) {
      const source = model.getLineToolById(id);
      if (!source) continue;
      if (source.toolname !== 'LineToolOrder') return false;
      found = true;
    }
    return found;
  } catch {
    // A chart being replaced may no longer answer lookups. Keep its native save.
    return false;
  }
}

function removingOrderId(source) {
  try {
    return source?.toolname === 'LineToolOrder' && typeof source.id === 'function' ? source.id() : null;
  } catch {
    // An unreadable source must still be removed and its native event delivered.
    return null;
  }
}

/**
 * TradingView detaches the source before emitting remove, synchronously inside
 * removeSource. Capture its identity for that call only. A shared model prototype
 * also covers charts created later in this iframe. Nested removals shadow it.
 */
function trackRemovals(collection) {
  const models = chartModels(collection);
  if (!models?.length) return null;
  let owner = Object.getPrototypeOf(models[0]);
  while (owner && !Object.hasOwn(owner, 'removeSource')) owner = Object.getPrototypeOf(owner);
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, 'removeSource');
  if (!descriptor?.writable || typeof descriptor.value !== 'function') return null;
  const removeSource = descriptor.value;
  let removing = null;
  Object.defineProperty(owner, 'removeSource', {
    ...descriptor,
    value: function (source) {
      const previous = removing;
      removing = removingOrderId(source);
      try { return Reflect.apply(removeSource, this, arguments); }
      finally { removing = previous; }
    },
  });
  return id => removing != null && removing === id;
}

function observeSubscriptions(api, stats) {
  const collection = api?._chartWidgetCollection;
  if (typeof collection?.getAll !== 'function' || typeof api.subscribe !== 'function'
    || typeof api.unsubscribe !== 'function') return;
  const { subscribe, unsubscribe } = api;
  const identify = identifyHostSubscription();
  let hostCallback;
  let listener;
  let registrations = 0;
  let isRemoving;
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
        isRemoving = trackRemovals(collection);
      } catch {
        // Keep this widget native if its model was disposed during installation.
        return Reflect.apply(subscribe, this, arguments);
      }
    }
    if (this !== api || event !== 'drawing_event' || callback !== hostCallback || !isRemoving) {
      return Reflect.apply(subscribe, this, arguments);
    }
    if (!listener) {
      listener = function (id, type) {
        if ((type === 'remove' && isRemoving(id))
          || (type === 'properties_changed' && isLiveOrderLine(collection, id))) {
          stats.skipped++;
          return;
        }
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
}

/** Binance loads a same-origin bootstrap document, then rewrites it. Arm the
 * widgetReady callback after document.open clears old listeners but before the
 * host can subscribe. The final iframe load alone would miss the subscription.
 */
export function observeOrderLineSaves(document) {
  const stats = { matched: 0, skipped: 0 };
  const observed = new WeakSet();
  document.addEventListener('load', ({ target: frame }) => {
    if (frame.tagName !== 'IFRAME' || !frame.id.startsWith('tradingview_')
      || !frame.closest('.chart-widget-root') || !frame.contentDocument) return;
    frame.addEventListener('load', () => queueMicrotask(() => {
      if (!frame.contentDocument) return;
      const win = frame.contentWindow;
      win.addEventListener('innerWindowLoad', () => {
        if (typeof win.widgetReady !== 'function') return;
        win.widgetReady(() => {
          const api = win.tradingViewApi;
          if (!api || observed.has(api)) return;
          observed.add(api);
          observeSubscriptions(api, stats);
        });
      }, { capture: true, once: true });
    }), { once: true });
  }, true);
  return () => ({ ...stats });
}
