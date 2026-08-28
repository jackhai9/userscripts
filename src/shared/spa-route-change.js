const ROUTE_CHANGE_EVENT = 'jh-userscripts:spa-route-change';
const ROUTE_PATCH_MARKER = Symbol.for('jh-userscripts.spa-route-change-patched');
const ROUTE_DISPATCH_STATE = Symbol.for('jh-userscripts.spa-route-change-dispatch');

function dispatchRouteChange(view) {
  const href = view.location.href;
  if (view[ROUTE_DISPATCH_STATE]?.href === href) return;
  const state = { href };
  view[ROUTE_DISPATCH_STATE] = state;
  view.dispatchEvent(new view.Event(ROUTE_CHANGE_EVENT));
  view.queueMicrotask(() => {
    if (view[ROUTE_DISPATCH_STATE] === state) delete view[ROUTE_DISPATCH_STATE];
  });
}

function patchHistoryMethod(view, methodName) {
  const current = view.history[methodName];
  if (current[ROUTE_PATCH_MARKER]) return;

  function routeAwareHistoryMethod(...args) {
    const previousHref = view.location.href;
    const result = Reflect.apply(current, this, args);
    if (view.location.href !== previousHref) dispatchRouteChange(view);
    return result;
  }
  Object.defineProperty(routeAwareHistoryMethod, ROUTE_PATCH_MARKER, { value: true });
  view.history[methodName] = routeAwareHistoryMethod;
}

export function ensureSpaRouteChangePatched(view) {
  if (!view?.history) throw new Error('SPA route patch requires a window');
  patchHistoryMethod(view, 'pushState');
  patchHistoryMethod(view, 'replaceState');
}

export function installSpaRouteChangeListener(view, listener) {
  if (!view?.history || typeof listener !== 'function') {
    throw new Error('SPA route listener requires a window and callback');
  }

  ensureSpaRouteChangePatched(view);
  view.addEventListener(ROUTE_CHANGE_EVENT, listener);
  view.addEventListener('popstate', listener);
  view.addEventListener('hashchange', listener);

  return () => {
    view.removeEventListener(ROUTE_CHANGE_EVENT, listener);
    view.removeEventListener('popstate', listener);
    view.removeEventListener('hashchange', listener);
  };
}
