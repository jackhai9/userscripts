import { createBollingerMonitor } from './monitor.js';
import { isChartMutationBlocked } from '../shared/chart-mutation-owners.js';
import { isFuturesTradingPathname, parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';
import { ensureSpaRouteChangePatched, installSpaRouteChangeListener } from '../shared/spa-route-change.js';

const INSTANCE = Symbol.for('jh-userscripts.strategy29-bollinger');
const CONFLICT = 'Strategy 29 stopped: update Orderbook to 2.7.199 or disable its embedded Bollinger version, then reload this page.';

/** This is a migration refusal, not compatibility with the old independently owned save wrapper. */
export function hasEmbeddedBollinger(view) {
  const debug = view.__TM_CLOSE_LONG_DEBUG__;
  return !!debug && Object.getOwnPropertyDescriptor(debug, 'bollingerAlertState') !== undefined;
}

/** Page-context singleton: independent installation, no exchange/account/network operations. */
export function installStrategy29(view) {
  if (view[INSTANCE] !== undefined) {
    if (view[INSTANCE].version !== 1) throw new Error('Incompatible Strategy 29 runtime; reload the page');
    return view[INSTANCE].runtime;
  }
  const document = view.document;
  let timer = null;
  let failed = null;
  let disposed = false;
  let removeRouteListener = null;
  const noticeId = 'jh-strategy29-bollinger-status';
  function showFailure() {
    if (!failed || !document.body) return;
    let notice = document.getElementById(noticeId);
    if (!notice) {
      notice = document.createElement('div');
      notice.id = noticeId;
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:10000;max-width:420px;padding:10px;background:#332b16;color:#ffcf67;font:13px sans-serif;pointer-events:none';
      document.body.append(notice);
    }
    notice.textContent = failed;
  }
  const monitor = createBollingerMonitor({
    document,
    getCurrentSymbol: () => parseFuturesTradingSymbolFromPathname(view.location.pathname),
    isFuturesTradingPage: () => !disposed && !failed && isFuturesTradingPathname(view.location.pathname),
    isTradingViewDrawingMutationBusy: () => hasEmbeddedBollinger(view) || isChartMutationBlocked(view),
    err: (...args) => view.console.error('[Strategy29]', ...args),
    warn: (...args) => view.console.warn('[Strategy29]', ...args),
  });
  function pause() {
    if (timer !== null) view.clearInterval(timer);
    timer = null;
    monitor.stop();
  }
  function fail(message) {
    failed = message;
    pause();
    showFailure();
  }
  function sample() {
    if (disposed || failed || document.hidden) return;
    if (hasEmbeddedBollinger(view)) { fail(CONFLICT); return; }
    ensureSpaRouteChangePatched(view);
    if (!isFuturesTradingPathname(view.location.pathname)) { monitor.stop(); return; }
    // Job boundary: unexpected synchronization errors stop this observer only.
    void monitor.tick().catch(error => fail(`Strategy 29 stopped: ${error.message}`));
  }
  function resume() {
    if (disposed || failed || document.hidden) return;
    sample();
    if (!failed && timer === null) timer = view.setInterval(sample, 1000);
  }
  function onVisibility() { if (document.hidden) pause(); else resume(); }
  function onPageHide(event) { if (event.persisted) pause(); else runtime.dispose(); }
  function onPageShow() { resume(); }
  const runtime = Object.freeze({
    get diagnostics() { return { ...monitor.diagnostics, runtimeFailure: failed, disposed, timerRunning: timer !== null }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      removeRouteListener();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('DOMContentLoaded', showFailure);
      view.removeEventListener('pagehide', onPageHide);
      view.removeEventListener('pageshow', onPageShow);
      document.getElementById(noticeId)?.remove();
    },
  });
  Object.defineProperty(view, INSTANCE, { value: Object.freeze({ version: 1, runtime }) });
  Object.defineProperty(view, '__TM_STRATEGY29_DEBUG__', { value: runtime });
  removeRouteListener = installSpaRouteChangeListener(view, sample);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('DOMContentLoaded', showFailure, { once: true });
  view.addEventListener('pagehide', onPageHide);
  view.addEventListener('pageshow', onPageShow);
  resume();
  return runtime;
}
