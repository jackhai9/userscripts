import assert from 'node:assert/strict';
import { loadFixtureDom } from './dom.js';

/** Positive OHLC candles provide both trend directions without supplying detector decisions. */
export function createOscillatingStrategyBars(count = 165) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + 6 * Math.sin(index / 11) + 0.7 * Math.cos(index / 3);
    return { time: (index + 1) * 60, open: close + 0.2, high: close + 1.8, low: close - 1.9, close };
  });
}

export function exportStrategyBars(bars) {
  return {
    schema: ['time', 'open', 'high', 'low', 'close'].map(type => ({ type })),
    data: bars.map(bar => ({ 0: bar.time, 1: bar.open, 2: bar.high, 3: bar.low, 4: bar.close })),
  };
}

function createNativeSubscription() {
  const listeners = new Map();
  return {
    subscribe(owner, callback) { listeners.set(callback, owner); },
    unsubscribe(owner, callback) {
      assert.equal(listeners.get(callback), owner);
      listeners.delete(callback);
    },
    emit() { for (const callback of [...listeners.keys()]) callback(); },
    get size() { return listeners.size; },
  };
}

/** Model native chart I/O and ownership only; no detector, monitor, or marker-layer method is replaced. */
export function createStrategy29ChartHost({ bars = createOscillatingStrategyBars(), resolution = '1', omittedMethods = [] } = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><iframe></iframe></div>');
  const view = dom.window;
  const document = view.document;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const root = document.querySelector('.chart-widget-root');
  const intervalChanged = createNativeSubscription();
  const dataLoaded = createNativeSubscription();
  const shapes = new Map();
  const created = [];
  const removed = [];
  const propertyWrites = [];
  const exports = [];
  const exportQueue = [];
  const creationQueue = [];
  const shapeListQueue = [];
  const pointReadActions = [];
  const propertyOverrides = new Map();
  let currentBars = bars;
  let currentResolution = resolution;
  let symbol = 'BTRUSDT@PRICETYPE=LAST';
  let modelReady = true;
  let dataReady = true;
  let ignorePropertyWrites = false;
  let nativeIntervalSubscription = intervalChanged;
  let nextId = 1;

  const chart = {
    hasModel: () => modelReady,
    dataReady: () => dataReady,
    resolution() { assert.equal(modelReady, true); return currentResolution; },
    symbol: () => symbol,
    onIntervalChanged: () => nativeIntervalSubscription,
    onDataLoaded: () => dataLoaded,
    async exportData(options) {
      exports.push(structuredClone(options));
      const next = exportQueue.shift();
      if (next) return next();
      return exportStrategyBars(currentBars);
    },
    async createShape(point, options) {
      created.push({ point: structuredClone(point), options: structuredClone(options) });
      const next = creationQueue.shift();
      if (next) {
        const result = await next();
        if (result.kind === 'id') return result.value;
      }
      const id = 'native-' + nextId++;
      const record = {
        point: structuredClone(point), options: structuredClone(options),
        properties: { ...structuredClone(options.overrides), icon: options.icon },
        getPoints() {
          const result = [structuredClone(record.point)];
          pointReadActions.shift()?.();
          return result;
        },
        getProperties() {
          return propertyOverrides.has(id) ? propertyOverrides.get(id) : structuredClone(record.properties);
        },
        setProperties(properties, saveDefaults) {
          propertyWrites.push({ id, properties: structuredClone(properties), saveDefaults });
          if (!ignorePropertyWrites) Object.assign(record.properties, structuredClone(properties));
        },
      };
      shapes.set(id, record);
      return id;
    },
    getShapeById: id => shapes.get(id),
    getAllShapes: () => shapeListQueue.length > 0
      ? shapeListQueue.shift()
      : [...shapes].map(([id, record]) => ({ id, name: record.options.shape })),
    removeEntity(id) {
      assert.equal(shapes.has(id), true, 'Native removal requires an existing entity');
      removed.push(id);
      shapes.delete(id);
    },
  };
  for (const method of omittedMethods) {
    assert.equal(typeof chart[method], 'function', 'Only a declared native chart capability can be omitted');
    delete chart[method];
  }
  let activeChart = chart;
  const tradingViewApi = {
    activeChart: () => activeChart,
    saveChart(callback) {
      callback({ drawings: [...shapes].filter(([, record]) => !record.options.disableSave).map(([id]) => ({ id })) });
    },
  };
  document.querySelector('iframe').contentWindow.tradingViewApi = tradingViewApi;
  return {
    dom, view, document, root, chart, tradingViewApi,
    created, removed, propertyWrites, exports, shapes, intervalChanged, dataLoaded,
    setBars(value) { currentBars = value; },
    setSymbol(value) { symbol = value; },
    setActiveChart(value) { activeChart = value; },
    setModelReady(value) { modelReady = value; },
    setDataReady(value) { dataReady = value; },
    setIntervalSubscription(value) { nativeIntervalSubscription = value; },
    listShapesNext(value) { shapeListQueue.push(value); },
    setHidden(value) { Object.defineProperty(document, 'hidden', { configurable: true, value }); },
    changeInterval(value) { currentResolution = value; dataReady = false; intervalChanged.emit(); },
    finishData() { dataReady = true; dataLoaded.emit(); },
    ignorePropertyWrites(value) { ignorePropertyWrites = value; },
    setNativeProperties(id, value) { assert.equal(shapes.has(id), true); propertyOverrides.set(id, value); },
    editProperties(id, properties) { Object.assign(shapes.get(id).properties, properties); },
    onNextPointRead(action) { pointReadActions.push(action); },
    failNextExport(reason) { exportQueue.push(() => Promise.reject(reason)); },
    exportNext(value) { exportQueue.push(() => Promise.resolve(value)); },
    holdNextExport() {
      const entered = Promise.withResolvers();
      const response = Promise.withResolvers();
      exportQueue.push(() => { entered.resolve(); return response.promise; });
      return { entered: entered.promise, resolve: value => response.resolve(value), reject: reason => response.reject(reason) };
    },
    holdNextCreation() {
      const entered = Promise.withResolvers();
      const response = Promise.withResolvers();
      creationQueue.push(() => { entered.resolve(); return response.promise; });
      return { entered: entered.promise, release: () => response.resolve({ kind: 'created' }) };
    },
    returnNextCreationId(value) { creationQueue.push(() => Promise.resolve({ kind: 'id', value })); },
    addForeignShape(id) { shapes.set(id, { options: { shape: 'trend_line', disableSave: false } }); },
    close() { dom.window.close(); },
  };
}

/** FIFO gateway transport preserves declared responses and cancellation ownership without business validation. */
export function createStrategy29RequestHost() {
  const queue = [];
  const requests = [];
  return {
    requests,
    respond(body, status = 200) { queue.push(() => ({ status, responseText: JSON.stringify(body) })); },
    respondRaw(value) { queue.push(() => value); },
    reject(error) { queue.push(() => Promise.reject(error)); },
    hold() {
      const entered = Promise.withResolvers();
      const result = Promise.withResolvers();
      queue.push(() => { entered.resolve(); return result.promise; });
      return { entered: entered.promise, respond: (body, status = 200) => result.resolve({ status, responseText: JSON.stringify(body) }) };
    },
    async request(options) {
      requests.push(options);
      const next = queue.shift();
      assert.equal(typeof next, 'function', 'Every gateway request requires a declared response');
      return next();
    },
    get remaining() { return queue.length; },
  };
}

/** Expose a separate installed provider's public protocol without interpreting or repairing its payloads. */
export function createStrategyGatewayProviderHost(view) {
  const slot = Symbol.for('jh-userscripts.signal-gateway');
  assert.equal(view[slot], undefined, 'The provider boundary requires an unclaimed public bridge slot');
  const transport = createStrategy29RequestHost();
  let version = 1;
  let state = { available: true, configured: true, settingsRevision: 1 };
  const bridge = {
    get version() { return version; },
    getState: () => state,
    request: (path, signal) => transport.request({ path, signal }),
  };
  Object.defineProperty(view, slot, { configurable: true, value: bridge });
  return {
    bridge, transport,
    setVersion(value) { version = value; },
    setState(value) { state = value; },
  };
}
