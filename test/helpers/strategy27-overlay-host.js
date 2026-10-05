import { loadFixtureDom } from './dom.js';
import { attachChartMarkerOverlayHost } from './chart-marker-overlay-host.js';

/** The native boundary exposes exact candle lookup and real SVG DOM without native drawing side effects. */
export function createStrategy27OverlayHost({ bars = [[10, 1.25, 1.3, 1.2, 1.25]], resolution = '1S', symbol = 'BTRUSDT@PRICETYPE=LAST', priceToCoordinate = price => 2000 - price * 1000, coordinateToPrice = y => (2000 - y) / 1000 } = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><iframe></iframe></div>');
  const document = dom.window.document;
  let currentSymbol = symbol;
  let currentResolution = resolution;
  const candles = new Map(bars.map(bar => [bar[0], bar]));
  const created = [], removed = [], saves = [];
  const shapes = new Map([['user-owned', { untouched: true }]]);
  const delegate = () => {
    const listeners = new Map();
    return { subscribe(owner, callback) { listeners.set(callback, owner); }, unsubscribe(owner, callback) { if (listeners.get(callback) !== owner) throw new Error('Invalid subscription owner'); listeners.delete(callback); }, emit() { for (const callback of [...listeners.keys()]) callback(); }, get size() { return listeners.size; } };
  };
  const interval = delegate(), loaded = delegate();
  const chart = {
    symbol: () => currentSymbol, resolution: () => currentResolution,
    hasModel: () => true, dataReady: () => true,
    onIntervalChanged: () => interval, onDataLoaded: () => loaded,
    createShape(...args) { created.push(args); throw new Error('Native marker creation is forbidden'); },
    removeEntity(id) { removed.push(id); throw new Error('Native marker removal is forbidden'); },
    getAllShapes: () => [...shapes.keys()].map(id => ({ id })), getShapeById: id => shapes.get(id),
  };
  const overlay = attachChartMarkerOverlayHost({ chart, document });
  overlay.setViewport(1000, 2000);
  overlay.setProjection({ time: index => index * 10, price: priceToCoordinate });
  overlay.priceScale.coordinateToPrice = coordinateToPrice;
  overlay.timeScale.timePointToIndex = (time, mode) => mode === 0 ? (candles.has(time) ? time : null) : ([...candles.keys()].filter(value => value <= time).sort((a, b) => b - a)[0] ?? null);
  chart.getSeries = () => ({ data: () => ({ valueAt: index => candles.get(index) ?? null }) });
  const tradingViewApi = { activeChart: () => chart, saveChart(...args) { saves.push(args); throw new Error('Marker saves are forbidden'); } };
  document.querySelector('iframe').contentWindow.tradingViewApi = tradingViewApi;
  const target = { chart, chartRoot: document.querySelector('.chart-widget-root'), tradingViewApi, routeSymbol: String(symbol || '').split('@')[0], resolution };
  return { dom, document, chart, target, overlay, created, removed, saves, shapes, candles, interval, loaded,
    setSymbol(value) { currentSymbol = value; },
    setResolution(value) { currentResolution = value; interval.emit(); },
    fireDataUpdated() { overlay.events.dataUpdated.emit(); },
    markers: () => overlay.markers(),
    close() { dom.window.close(); },
  };
}
