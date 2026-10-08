import { SIGNAL_GATEWAY_BRIDGE } from '../shared/signal-gateway-bridge.js';
import { parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';
import { installSpaRouteChangeListener } from '../shared/spa-route-change.js';
import { createDraggableStatusView } from '../shared/draggable-status-view.js';
import { isChartMutationBlocked } from '../shared/chart-mutation-owners.js';
import { findBinanceTradingViewTarget } from '../shared/tradingview-target.js';
import { usdtRouteToCanonical } from '../shared/canonical-symbol.js';
import { TradingViewBarSnapshotInconsistentError } from '../binance-strategy29-bollinger/core/bearish-bollinger-pattern.js';
import { createBollingerIntervalSession, createBollingerMarkerLayer, isBearishBollingerChartTargetCurrent,
  exportClosedTradingViewBars, tradingViewResolutionToSeconds } from '../binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { parseStrategy31Events, STRATEGY31_PERIODS } from './event-contract.js';
import { localizedText, formatLocalizedText, resolveUiLocaleFromPathname } from '../binance-orderbook-trade/contracts/panel-copy.js';

const STATUS_COPY = Object.freeze({
  unsupportedMarket: localizedText('策略31：不支持的交易市场', 'Strategy31: unsupported market'),
  unsupportedInterval: localizedText('策略31：不支持的图表周期', 'Strategy31: unsupported interval'),
  updateClient: localizedText('策略31：请更新 CorsairQuant 信号客户端', 'Strategy31: update CorsairQuant signal client'),
  configureClient: localizedText('策略31：请配置 CorsairQuant 信号客户端', 'Strategy31: configure CorsairQuant signal client'),
  unavailable: localizedText('策略31：信号服务不可用', 'Strategy31: signal service unavailable'),
  stopped: localizedText('策略31已停止：图表或信号数据无效', 'Strategy31 stopped: invalid chart or signal data'),
});

/** Server signals only; this lifecycle owns neither market acquisition nor trading actions. */
export function installStrategy31(view, { getValue, setValue }) {
  const key = Symbol.for('jh-userscripts.strategy31');
  if (view[key]) return view[key];
  if (typeof getValue !== 'function' || typeof setValue !== 'function') {
    throw new TypeError('Strategy31 requires private storage adapters');
  }
  let context = null, intervalOwner = null, inflight = null, disposed = false, failed = false;
  const retired = new Set();
  const document = view.document;
  /** Invalid preferences fail at installation, outside the signal job's failure-notice boundary. */
  const status = createDraggableStatusView(view, {
    id: 'jh-strategy31-status',
    loadPosition: () => getValue('strategy31StatusPosition', null),
    savePosition: position => setValue('strategy31StatusPosition', position),
    defaultPosition: node => ({ left: 16, top: view.innerHeight - node.getBoundingClientRect().height - 40 }),
  });
  let statusText = '';
  /** Retain both languages so a route change can update even a stopped or pending observer. */
  function renderNotice() {
    if (!status.visible) return;
    status.show(formatLocalizedText(statusText, resolveUiLocaleFromPathname(view.location.pathname)));
  }
  function notice(text) {
    if (!document.body || !parseFuturesTradingSymbolFromPathname(view.location.pathname)) return;
    statusText = text;
    status.show(formatLocalizedText(statusText, resolveUiLocaleFromPathname(view.location.pathname)));
  }
  function retire() {
    if (context) { context.layer.clear(); retired.add(context.layer); context = null; }
    inflight?.abort();
  }
  function releaseChart() {
    retire();
    intervalOwner?.session.dispose();
    intervalOwner = null;
  }
  function cleanup() {
    for (const layer of retired) if (layer.clear()) retired.delete(layer);
    if ((disposed || failed) && retired.size === 0) view.clearInterval(timer);
  }
  function current(candidate) {
    return !disposed && !failed && !document.hidden && context === candidate
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
      status.hide();
      return;
    }
    if (failed || document.hidden || inflight) return;
    if (!route.endsWith('USDT')) { releaseChart(); cleanup(); notice(STATUS_COPY.unsupportedMarket); return; }
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
    if (!/^\d+(?:S|H|D|W)?$/i.test(String(resolution))) { retire(); cleanup(); notice(STATUS_COPY.unsupportedInterval); return; }
    const seconds = tradingViewResolutionToSeconds(resolution);
    const timeframe = Object.keys(STRATEGY31_PERIODS).find(period => STRATEGY31_PERIODS[period] === seconds);
    if (!timeframe) { retire(); cleanup(); notice(STATUS_COPY.unsupportedInterval); return; }
    if (context && (context.target.chart !== chart || context.target.routeSymbol !== route
      || context.target.chartRoot !== base.chartRoot || context.target.tradingViewApi !== base.tradingViewApi
      || context.target.resolution !== resolution || context.revision !== context.session.revision)) retire();
    cleanup();
    const session = intervalOwner.session;
    if (retired.size || !session.isCurrent(session.revision)) return;
    if (!context) {
      const target = { ...base, chart, resolution, resolutionSeconds: seconds, routeSymbol: route };
      context = { target, session, revision: session.revision,
        layer: createBollingerMarkerLayer(target, {
          canMutate: () => !isChartMutationBlocked(view), onRenderError: stopAfterFailure,
        }) };
    }
    const candidate = context;
    if (!current(candidate)) return;
    const provider = view[SIGNAL_GATEWAY_BRIDGE];
    if (!provider?.capabilities?.includes('strategy31')) { notice(STATUS_COPY.updateClient); return; }
    const state = provider.getState();
    if (!state.configured || !state.available) { notice(STATUS_COPY.configureClient); return; }
    const controller = new AbortController();
    const requestCurrent = () => current(candidate) && view[SIGNAL_GATEWAY_BRIDGE] === provider
      && provider.getState().settingsRevision === state.settingsRevision;
    inflight = controller;
    try {
      const path = `/v1/strategy31/events?${new URLSearchParams({ symbol, timeframe, limit: '200' })}`;
      const response = await provider.request(path, controller.signal);
      if (!requestCurrent()) return;
      if (response.kind !== 'response' || response.status !== 200) { notice(STATUS_COPY.unavailable); return; }
      const signals = parseStrategy31Events(JSON.parse(response.responseText), symbol, timeframe);
      // Server history is projected only onto exact loaded candle times.
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
      if (rendered && requestCurrent()) notice(localizedText(
        `策略31：${visible.length} 个图表信号 · ${timeframe}`,
        `Strategy31: ${visible.length} chart signals · ${timeframe}`,
      ));
    } finally { if (inflight === controller) inflight = null; }
  }
  function stopAfterFailure() {
    failed = true; releaseChart(); cleanup();
    if (!disposed) notice(STATUS_COPY.stopped);
  }
  function tick() {
    // Job boundary: invalid contracts stop this observer and expose a visible failure.
    return sample().catch(stopAfterFailure);
  }
  function visibility() { if (document.hidden) retire(); else void tick(); }
  const timer = view.setInterval(() => { void tick(); }, 5000);
  document.addEventListener('visibilitychange', visibility);
  // Route cleanup must remain active after invalid contracts stop the sampling timer.
  const removeRouteListener = installSpaRouteChangeListener(view, () => {
    if (!parseFuturesTradingSymbolFromPathname(view.location.pathname)) void tick();
    else renderNotice();
  });
  function dispose() {
    if (disposed) return;
    disposed = true; releaseChart(); cleanup();
    removeRouteListener();
    document.removeEventListener('visibilitychange', visibility);
    view.removeEventListener('beforeunload', dispose);
    status.dispose();
  }
  view.addEventListener('beforeunload', dispose);
  const runtime = Object.freeze({ sample: tick, dispose });
  Object.defineProperty(view, key, { value: runtime });
  void tick();
  return runtime;
}
