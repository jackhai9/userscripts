import { createBollingerMonitor } from './monitor.js';
import { isChartMutationBlocked } from '../shared/chart-mutation-owners.js';
import { isFuturesTradingPathname, parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';
import { ensureSpaRouteChangePatched, installSpaRouteChangeListener } from '../shared/spa-route-change.js';
import { createStrategy29RemoteSummary } from './remote-summary.js';
import { SIGNAL_HOST_READY, SIGNAL_HOST_READY_EVENT } from '../shared/strategy29-preferences-migration.js';

import { SUMMARY_COPY as COPY, formatLocalizedText, resolveUiLocaleFromPathname } from './ui-copy.js';

const INSTANCE = Symbol.for('jh-userscripts.strategy29-bollinger');
const RUNTIME_VERSION = 3;
const CONFLICT = COPY.conflict;

/** This is a migration refusal, not compatibility with the old independently owned save wrapper. */
export function hasEmbeddedBollinger(view) {
  const debug = view.__TM_CLOSE_LONG_DEBUG__;
  return !!debug && Object.getOwnPropertyDescriptor(debug, 'bollingerAlertState') !== undefined;
}

/** Page-context singleton with no exchange/account operations and an optional loopback read projection. */
export function installStrategy29(view, remoteAdapters = null) {
  if (view[INSTANCE] !== undefined) {
    if (view[INSTANCE].version !== RUNTIME_VERSION) throw new Error('Incompatible Strategy 29 runtime; reload the page');
    return view[INSTANCE].runtime;
  }
  const document = view.document;
  let timer = null;
  let failed = null;
  let disposed = false;
  let removeRouteListener = null;
  const remoteSummary = remoteAdapters === null
    ? null
    : createStrategy29RemoteSummary({ view, ...remoteAdapters });
  const noticeId = 'jh-strategy29-bollinger-status';
  const upgradeNoticeId = 'jh-strategy29-client-upgrade';
  function showUpgradeNotice() {
    if (remoteSummary !== null || disposed || view[SIGNAL_HOST_READY] === true || !isFuturesTradingPathname(view.location.pathname)) {
      document.getElementById(upgradeNoticeId)?.remove();
      return;
    }
    if (!document.body) return;
    let notice = document.getElementById(upgradeNoticeId);
    if (!notice) {
      notice = document.createElement('div');
      notice.id = upgradeNoticeId;
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:fixed;left:16px;top:16px;z-index:10000;max-width:420px;padding:10px;background:#332b16;color:#ffcf67;font:13px sans-serif;pointer-events:none';
      document.body.append(notice);
    }
    notice.textContent = formatLocalizedText(COPY.upgradeClient, resolveUiLocaleFromPathname(view.location.pathname));
  }
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
    notice.textContent = formatLocalizedText(failed, resolveUiLocaleFromPathname(view.location.pathname));
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
    remoteSummary?.pause();
  }
  function fail(message) {
    failed = message;
    pause();
    remoteSummary?.dispose();
    showFailure();
  }
  function sample() {
    if (disposed || document.hidden) return;
    showUpgradeNotice();
    if (failed) { showFailure(); return; }
    if (hasEmbeddedBollinger(view)) { fail(CONFLICT); return; }
    ensureSpaRouteChangePatched(view);
    void remoteSummary?.sample(Date.now());
    if (!isFuturesTradingPathname(view.location.pathname)) { monitor.stop(); return; }
    // Job boundary: unexpected synchronization errors stop this observer only.
    void monitor.tick().catch(error => fail(COPY.localStopped(error.message)));
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
    get diagnostics() {
      return {
        ...monitor.diagnostics,
        runtimeFailure: failed === null ? null : formatLocalizedText(failed, 'en'),
        disposed,
        timerRunning: timer !== null,
        remoteSummary: remoteSummary?.diagnostics ?? Object.freeze({ enabled: false, state: 'unavailable_in_this_installation' }),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      remoteSummary?.dispose();
      removeRouteListener();
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('DOMContentLoaded', showFailure);
      document.removeEventListener('DOMContentLoaded', showUpgradeNotice);
      view.removeEventListener(SIGNAL_HOST_READY_EVENT, showUpgradeNotice);
      view.removeEventListener('pagehide', onPageHide);
      view.removeEventListener('pageshow', onPageShow);
      document.getElementById(noticeId)?.remove();
      document.getElementById(upgradeNoticeId)?.remove();
    },
  });
  Object.defineProperty(view, INSTANCE, { value: Object.freeze({ version: RUNTIME_VERSION, runtime }) });
  Object.defineProperty(view, '__TM_STRATEGY29_DEBUG__', { value: runtime });
  removeRouteListener = installSpaRouteChangeListener(view, sample);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('DOMContentLoaded', showFailure, { once: true });
  document.addEventListener('DOMContentLoaded', showUpgradeNotice, { once: true });
  view.addEventListener(SIGNAL_HOST_READY_EVENT, showUpgradeNotice);
  view.addEventListener('pagehide', onPageHide);
  view.addEventListener('pageshow', onPageShow);
  resume();
  return runtime;
}
