import { SIGNAL_GATEWAY_BRIDGE } from '../shared/signal-gateway-bridge.js';
import { parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';
import { installSpaRouteChangeListener } from '../shared/spa-route-change.js';
import { isChartMutationBlocked } from '../shared/chart-mutation-owners.js';
import { findBinanceTradingViewTarget } from '../shared/tradingview-target.js';
import { usdtRouteToCanonical } from '../shared/canonical-symbol.js';
import { TradingViewBarSnapshotInconsistentError } from '../binance-strategy29-bollinger/core/bearish-bollinger-pattern.js';
import { createBollingerIntervalSession, createBollingerMarkerLayer, isBearishBollingerChartTargetCurrent,
  exportClosedTradingViewBars, tradingViewResolutionToSeconds } from '../binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { parseStrategy31Events, STRATEGY31_PERIODS } from './event-contract.js';

/** Server signals only; this lifecycle owns neither market acquisition nor trading actions. */
export function installStrategy31(view) {
  const key = Symbol.for('jh-userscripts.strategy31');
  if (view[key]) return view[key];
  let context = null, intervalOwner = null, inflight = null, disposed = false, failed = false;
  const retired = new Set();
  const document = view.document;
  function notice(text) {
    if (!document.body || !parseFuturesTradingSymbolFromPathname(view.location.pathname)) return;
    let node = document.getElementById('jh-strategy31-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'jh-strategy31-status';
      node.setAttribute('role', 'status');
      node.style.cssText = 'position:fixed;bottom:40px;left:16px;z-index:10000;padding:6px;background:#181a20;color:#ddd;font:12px sans-serif;pointer-events:none';
      document.body.append(node);
    }
    node.textContent = text;
  }
  function retire() {
    if (context) { retired.add(context.layer); context = null; }
    inflight?.abort();
  }
  function releaseChart() {
    retire();
    intervalOwner?.session.dispose();
    intervalOwner = null;
  }
  function cleanup() {
    if (isChartMutationBlocked(view)) return;
    for (const layer of retired) if (layer.clear()) retired.delete(layer);
    if ((disposed || failed) && retired.size === 0) view.clearInterval(timer);
  }
  function current(candidate) {
    return !disposed && !document.hidden && context === candidate
      && candidate.session.isCurrent(candidate.revision)
      && parseFuturesTradingSymbolFromPathname(view.location.pathname) === candidate.target.routeSymbol
      && isBearishBollingerChartTargetCurrent(document, candidate.target)
      && !isChartMutationBlocked(view);
  }
  async function sample() {
    cleanup();
    if (disposed) return;
    const route = parseFuturesTradingSymbolFromPathname(view.location.pathname);
    // Leaving the chart must retire pending work before request or visibility gates can defer cleanup.
    if (!route) {
      releaseChart(); cleanup();
      document.getElementById('jh-strategy31-status')?.remove();
      return;
    }
    if (failed || document.hidden || inflight) return;
    if (!route.endsWith('USDT')) { releaseChart(); cleanup(); notice('Strategy31: unsupported market'); return; }
    const symbol = usdtRouteToCanonical(route);
    const base = findBinanceTradingViewTarget(document);
    const chart = base?.tradingViewApi.activeChart?.();
    if (!chart?.hasModel() || String(chart.symbol()).split('@')[0] !== route) { releaseChart(); cleanup(); return; }
    // Keep the readiness subscription across interval changes: dataReady can still describe old bars.
    if (!intervalOwner || intervalOwner.chart !== chart || intervalOwner.route !== route) {
      releaseChart();
      intervalOwner = { chart, route, session: createBollingerIntervalSession(chart) };
    }
    const resolution = chart.resolution();
    if (!/^\d+(?:S|H|D|W)?$/i.test(String(resolution))) { retire(); cleanup(); notice('Strategy31: unsupported interval'); return; }
    const seconds = tradingViewResolutionToSeconds(resolution);
    const timeframe = Object.keys(STRATEGY31_PERIODS).find(period => STRATEGY31_PERIODS[period] === seconds);
    if (!timeframe) { retire(); cleanup(); notice('Strategy31: unsupported interval'); return; }
    if (context && (context.target.chart !== chart || context.target.routeSymbol !== route
      || context.target.chartRoot !== base.chartRoot || context.target.tradingViewApi !== base.tradingViewApi
      || context.target.resolution !== resolution || context.revision !== context.session.revision)) retire();
    cleanup();
    const session = intervalOwner.session;
    if (retired.size || !session.isCurrent(session.revision)) return;
    if (!context) {
      const target = { ...base, chart, resolution, resolutionSeconds: seconds, routeSymbol: route };
      context = { target, session, revision: session.revision,
        layer: createBollingerMarkerLayer(target, { canMutate: () => !isChartMutationBlocked(view) }) };
    }
    const candidate = context;
    if (!current(candidate)) return;
    const provider = view[SIGNAL_GATEWAY_BRIDGE];
    if (!provider?.capabilities?.includes('strategy31')) { notice('Strategy31: update CorsairQuant signal client'); return; }
    const state = provider.getState();
    if (!state.configured || !state.available) { notice('Strategy31: configure CorsairQuant signal client'); return; }
    const controller = new AbortController();
    const requestCurrent = () => current(candidate) && view[SIGNAL_GATEWAY_BRIDGE] === provider
      && provider.getState().settingsRevision === state.settingsRevision;
    inflight = controller;
    try {
      const path = `/v1/strategy31/events?${new URLSearchParams({ symbol, timeframe, limit: '200' })}`;
      const response = await provider.request(path, controller.signal);
      if (!requestCurrent()) return;
      if (response.kind !== 'response' || response.status !== 200) { notice('Strategy31: signal service unavailable'); return; }
      const signals = parseStrategy31Events(JSON.parse(response.responseText), symbol, timeframe);
      // Native drawings snap missing times to loaded bars; server history must be projected onto exact times.
      let bars;
      try {
        bars = await exportClosedTradingViewBars(candidate.target, candidate.session);
      } catch (error) {
        // A native feed update can expose inconsistent rows for one sample; retain the existing arrows.
        if (error instanceof TradingViewBarSnapshotInconsistentError) return;
        throw error;
      }
      if (!bars || !requestCurrent()) return;
      const loadedTimes = new Set(bars.map(bar => bar.time));
      const visible = signals.filter(signal => loadedTimes.has(signal.time));
      const rendered = await candidate.layer.render(visible, { isCurrent: requestCurrent });
      if (rendered && requestCurrent()) notice(`Strategy31: ${visible.length} chart signals · ${timeframe}`);
    } finally { if (inflight === controller) inflight = null; }
  }
  function tick() {
    // Job boundary: invalid contracts stop this observer and expose a visible failure.
    return sample().catch(() => { failed = true; releaseChart(); cleanup(); if (!disposed) notice('Strategy31 stopped: invalid chart or signal data'); });
  }
  function visibility() { if (document.hidden) retire(); else void tick(); }
  const timer = view.setInterval(() => { void tick(); }, 5000);
  document.addEventListener('visibilitychange', visibility);
  // Route cleanup must remain active after invalid contracts stop the sampling timer.
  const removeRouteListener = installSpaRouteChangeListener(view, () => {
    if (!parseFuturesTradingSymbolFromPathname(view.location.pathname)) void tick();
  });
  const runtime = Object.freeze({ sample: tick, dispose() {
    disposed = true; releaseChart(); cleanup();
    removeRouteListener();
    document.removeEventListener('visibilitychange', visibility);
    document.getElementById('jh-strategy31-status')?.remove();
  } });
  Object.defineProperty(view, key, { value: runtime });
  void tick();
  return runtime;
}
