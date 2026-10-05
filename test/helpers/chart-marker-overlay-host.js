import assert from 'node:assert/strict';

/** Host API mirrors the inspected Binance TradingView main-pane coordinate and delegate contract. */
export function attachChartMarkerOverlayHost({ chart, document, bars = null }) {
  const paneDocument = document.querySelector('iframe')?.contentDocument || document;
  const view = paneDocument.defaultView;
  const pane = paneDocument.createElement('div');
  pane.style.position = 'relative';
  pane.className = 'chart-gui-wrapper';
  const canvas = paneDocument.createElement('canvas');
  pane.append(canvas);
  paneDocument.body.append(pane);
  let width = 1000;
  let height = 500;
  let projectTime = index => index / 60;
  let projectPrice = price => height - price;
  let readTime = index => bars ? bars[index]?.time : index;
  let resolveIndex = time => bars ? bars.findIndex(bar => bar.time === time) : time;
  Object.defineProperties(pane, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
  pane.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height });
  canvas.getBoundingClientRect = pane.getBoundingClientRect;
  const events = {};
  for (const name of ['logicalRangeChanged', 'barSpacingChanged', 'rightOffsetChanged', 'priceRangeChanged', 'modeChanged', 'internalHeightChanged', 'dataUpdated']) {
    const listeners = new Map();
    events[name] = {
      subscribe(owner, fn) { listeners.set(fn, owner); },
      unsubscribe(owner, fn) { assert.equal(listeners.get(fn), owner); listeners.delete(fn); },
      emit() { for (const fn of [...listeners.keys()]) fn(); },
      get size() { return listeners.size; },
    };
  }
  const timeScale = {
    timePointToIndex: (time, mode) => { assert.equal(mode, 0); return resolveIndex(time); },
    indexToCoordinate: index => projectTime(index),
    logicalRangeChanged: () => events.logicalRangeChanged,
    barSpacingChanged: () => events.barSpacingChanged,
    rightOffsetChanged: () => events.rightOffsetChanged,
  };
  const priceScale = {
    priceToCoordinate(price, first) { assert.equal(first, 100); return projectPrice(price); },
    priceRangeChanged: () => events.priceRangeChanged,
    modeChanged: () => events.modeChanged,
    internalHeightChanged: () => events.internalHeightChanged,
  };
  const series = { priceScale: () => priceScale, firstValue: () => 100, dataUpdated: () => events.dataUpdated };
  const paneState = {};
  const model = { mainSeries: () => series, timeScale: () => timeScale, paneForSource(source) { assert.equal(source, series); return paneState; } };
  const paneWidget = { canvasElement: () => canvas };
  chart._chartWidget = { model: () => ({ model: () => model }), paneByState(state) { assert.equal(state, paneState); return paneWidget; } };
  chart.getSeries = () => ({ data: () => ({ valueAt: index => { const time = readTime(index); return time === undefined ? null : [time, 1, 2, 0, 1]; } }) });
  let frameId = 0;
  const frames = new Map();
  view.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  view.cancelAnimationFrame = id => { frames.delete(id); };
  const observers = new Set();
  view.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(element) { assert.equal(element, pane); observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  return {
    pane, canvas, events, timeScale, priceScale, series, model,
    markers: () => [...pane.querySelectorAll('[data-marker-id]')],
    flushFrames() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); },
    get pendingFrames() { return frames.size; },
    get subscriptions() { return Object.values(events).reduce((sum, event) => sum + event.size, 0) + observers.size; },
    setViewport(w, h) { width = w; height = h; for (const observer of observers) observer.callback([]); },
    setProjection({ time, price }) { if (time) projectTime = time; if (price) projectPrice = price; },
    setTimeLookup({ index, time }) { if (index) resolveIndex = index; if (time) readTime = time; },
    setHidden(hidden) { Object.defineProperty(document, 'hidden', { configurable: true, value: hidden }); document.dispatchEvent(new document.defaultView.Event('visibilitychange')); },
  };
}
