import assert from 'node:assert/strict';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { jsx, jsxs } from 'react/jsx-runtime';
import { JSDOM } from 'jsdom';

import { createNativeOrderNotificationFactory } from '../fixtures/binance-order-notifications/original-factories.js';

/** The SDK boundary retains distinct UM and CM subscribers and exact payloads. */
export function createNotificationStreams() {
  const channels = new Map([[false, new Set()], [true, new Set()]]);
  const subscriptions = [];
  return {
    subscriptions,
    getSDK({ isCM }) {
      assert.equal(typeof isCM, 'boolean');
      return {
        getUserOrderStream(options) {
          return {
            subscribe(listener) {
              channels.get(isCM).add(listener);
              subscriptions.push({ isCM, options });
              return () => channels.get(isCM).delete(listener);
            },
          };
        },
      };
    },
    emit(payload, isCM = false) {
      for (const listener of channels.get(isCM)) listener(payload);
    },
    size(isCM) {
      return channels.get(isCM).size;
    },
  };
}

/** Model only the native persistent preference boundary, with real React state. */
function createPreferences({ toastEnabled, soundEnabled }) {
  const values = new Map([
    ['open_order_status_toast', toastEnabled],
    ['open-order-notification-sound-open', soundEnabled],
  ]);
  return {
    zr(key) {
      assert.equal(values.has(key), true, `Unknown native preference ${key}`);
      const [data, setData] = React.useState(values.get(key));
      return { data, setData, hasInitialized: true };
    },
  };
}

/** Zustand is an external state boundary; subscribers receive actual snapshots. */
function createExternalStore(initialize) {
  const subscribers = new Set();
  let state = initialize((change) => {
    state = { ...state, ...change };
    for (const listener of subscribers) listener();
  });
  const subscribe = (listener) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  };
  const getSnapshot = () => state;
  return () => React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function ordinaryNotificationOrder(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    orderId: 42,
    clientOrderId: 'manual-order-42',
    type: 'LIMIT',
    orderType: 'LIMIT',
    origType: 'LIMIT',
    side: 'BUY',
    status: 'FILLED',
    operate: 'TRADE',
    ...overrides,
  };
}

/** Load complete captured factories, rejecting every undeclared host boundary. */
export function createNativeNotificationModules(dependencies, factories = new Map()) {
  const cache = new Map();
  function requireModule(id) {
    if (dependencies.has(id)) return dependencies.get(id);
    if (cache.has(id)) return cache.get(id).exports;
    const factory = factories.get(id) ?? createNativeOrderNotificationFactory(id);
    const module = { exports: {} };
    cache.set(id, module);
    factory(module, module.exports, requireModule);
    return module.exports;
  }
  requireModule.d = (exports, getters) => {
    for (const [key, get] of Object.entries(getters)) Object.defineProperty(exports, key, { enumerable: true, get });
  };
  requireModule.r = (exports) => Object.defineProperty(exports, '__esModule', { value: true });
  requireModule.n = (exports) => () => exports;
  return requireModule;
}

/** Execute the captured SDK schema and parser while replacing only transport creation. */
export function createNativeOrderDecoder(source = 'UM') {
  const transport = Object.freeze({ kind: 'controlled-order-transport' });
  let configuration;
  const dependencies = new Map([
    [61489, {
      s(client, options) {
        assert.equal(client.PMFuturesSource, source);
        configuration = options;
        return transport;
      },
    }],
    [53548, { G: (value) => {
      assert.equal(value, transport);
      return value;
    } }],
  ]);
  const native = createNativeNotificationModules(dependencies)(5558);
  assert.equal(native.CC({ type: 'futures', PMFuturesSource: source }), transport);
  return {
    eventType: configuration.eventType,
    decode(packet) {
      const orders = [];
      configuration.transform(packet)((order) => orders.push(order));
      return orders;
    },
  };
}

/**
 * Run Binance's actual cache-to-toast adapter. The query cache, stream lifecycle,
 * and batching transport are external boundaries; native 4189 owns event choice.
 */
export function attachNativeOrderEventHost({ streams, emitter }) {
  const queries = new Map();
  const key = (isCM) => `orders:${isCM}`;
  const queryClient = {
    setQueryData(queryKey, update) {
      queries.set(queryKey, update(queries.get(queryKey)));
    },
  };
  const batcher = () => {
    const workers = new Set();
    return {
      addWorker: (worker) => workers.add(worker),
      removeWorker: (worker) => workers.delete(worker),
      push(order) {
        for (const worker of workers) worker(Array.isArray(order) ? order : [order]);
      },
    };
  };
  const cmBatcher = batcher();
  const umBatcher = batcher();
  const cleanups = [];
  const dependencies = new Map([
    [41594, React],
    [87017, {}],
    [48187, { mp: () => { throw new Error('Financial network access is outside the notification fixture'); } }],
    [57861, { post: () => { throw new Error('Financial network access is outside the notification fixture'); } }],
    [41466, {}],
    [43335, { Bz: { OPEN_ORDERS: key } }],
    [26860, {}],
    [84266, {}],
    [16921, {}],
    [90291, {}],
    [47738, {
      Y: ({ subscribeToStreamFn }) => (options) => {
        cleanups.push(subscribeToStreamFn({
          ...options,
          stream: options.getSDK({ isCM: options.isCM }),
        }));
      },
    }],
    [95541, { CX: cmBatcher, kc: () => umBatcher }],
    [71822, { J: emitter }],
  ]);
  const native = createNativeNotificationModules(dependencies)(4189);
  for (const isCM of [false, true]) {
    native.$t({
      enabled: true,
      isCM,
      isPM2: false,
      getSDK: (options) => streams.getSDK(options),
      queryClient,
      copyTradingPayload: {},
    });
  }
  return {
    orders: (isCM = false) => queries.get(key(isCM))?.data ?? [],
    dispose() {
      for (const cleanup of cleanups) cleanup();
    },
  };
}

/**
 * Render complete captured Binance hooks and providers with real React effects.
 * Only host I/O, preferences, and external store boundaries are replaced.
 */
export async function createNotificationHarness(t, {
  patched = true,
  pathname = '/en/futures/BTCUSDT',
  toastEnabled = true,
  soundEnabled = true,
  variantChunk = '37511',
  soundSourceSha256 = '5362a54e61f022714e673e166b62e3c22997084ca7a9f4e676475ec91cfcfaa8',
  driftModule = null,
  firstPlayPending = false,
  inspectSoundQueue = false,
} = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1800000000000 });
  const dom = new JSDOM('<main id="root"></main>', { url: `https://www.binance.com${pathname}` });
  const saved = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    self: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const streams = createNotificationStreams();
  const toasts = [];
  const audio = [];
  let resolveFirstPlay;
  const firstPlay = firstPlayPending ? new Promise((resolve) => { resolveFirstPlay = resolve; }) : null;
  let playCount = 0;
  dom.window.HTMLMediaElement.prototype.load = function load() {
    audio.push({ kind: 'load', pathname: dom.window.location.pathname });
  };
  dom.window.HTMLMediaElement.prototype.play = function play() {
    playCount += 1;
    audio.push({ kind: 'play', pathname: dom.window.location.pathname });
    return playCount === 1 && firstPlay ? firstPlay : Promise.resolve();
  };
  const copyTradingParams = Object.freeze({});
  const dependencies = new Map([
    [41594, React],
    [31085, { jsx, jsxs }],
    [75510, { _: (array) => [...array] }],
    [94917, { _: (instance, Constructor) => assert.equal(instance instanceof Constructor, true) }],
    [17409, { a0: 'classic', K5: 'https://static.test.invalid' }],
    [61523, { d4: (selector) => selector({ setting: { layout: 'classic' } }) }],
    [92873, { o: () => ({ getI18n: (_key, options) => options.defaultValue }) }],
    [64041, { h: () => ({ enqueueNotification: (message, options) => toasts.push({ message, options }) }) }],
    [51471, createPreferences({ toastEnabled, soundEnabled })],
    [80065, { A: createExternalStore }],
    [96636, { Z: () => ({ isEUFuturesUrl: false }) }],
    [16921, { Gw: () => copyTradingParams }],
    [72363, { Ri: (options) => streams.getSDK(options) }],
    [79515, { nH: () => true, Py: () => ({ isExistFutureAccount: true }), ON: () => ({ isPM2: false }) }],
    [88478, { A: () => null }],
    [48651, { ud: () => ({ getI18n: (_key, options) => options.defaultValue }) }],
    [34175, { Zu: () => undefined }],
    [10157, { XE: 'notification-switch', IG: 'notification-label' }],
  ]);
  const scope = patched
    ? (await import('../../src/binance-orderbook-trade/order-notifications/runtime.js')).createOrderNotificationScope()
    : null;
  const factories = new Map();
  for (const id of [30877, 39116, 55401, 40477, 70020, 22584, 34122]) {
    const original = createNativeOrderNotificationFactory(id, id === 30877 ? variantChunk : undefined,
      id === 39116 ? soundSourceSha256 : undefined);
    const target = scope?.targets[id];
    if (target && id === driftModule) {
      const driftedFactory = function changedNativeFactory(...args) {
        return Reflect.apply(original, this, args);
      };
      assert.throws(() => target.replace(driftedFactory), SyntaxError);
      target.onFailure('source_mismatch');
      factories.set(id, driftedFactory);
    } else if (target) {
      factories.set(id, target.replace(original));
      target.onCapture();
    } else {
      factories.set(id, original);
    }
  }
  const requireModule = createNativeNotificationModules(dependencies, factories);
  const NativeEmitter = requireModule(22584).b;
  const emitter = new NativeEmitter();
  dependencies.set(71822, { J: emitter });
  const nativeHost = attachNativeOrderEventHost({ streams, emitter });
  const Provider = requireModule(55401).SoundNotificationProvider;
  const ToastRegister = requireModule(34122).OrderToastNotifyRegister;
  let inspectedQueue;
  function SoundQueueObserver() {
    inspectedQueue = requireModule(39116).E$().notifications;
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  await act(async () => root.render(React.createElement(Provider, null,
    React.createElement(ToastRegister),
    inspectSoundQueue ? React.createElement(SoundQueueObserver) : null,
  )));
  let disposed = false;
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await act(async () => root.unmount());
    nativeHost.dispose();
    t.mock.timers.reset();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  t.after(dispose);
  return {
    audio,
    toasts,
    streams,
    scope,
    dispose,
    nativeHost,
    queueSnapshot: () => [...inspectedQueue.current],
    async emitStream(order, { isCM = false } = {}) {
      await act(async () => streams.emit(order, isCM));
    },
    async emitToast(order, event = 'FILLED_NORMAL_ORDER') {
      await act(async () => emitter.emit(event, order));
    },
    async notify(order, options) {
      await act(async () => {
        streams.emit({ ...order, status: 'NEW' }, options?.isCM ?? false);
        streams.emit(order, options?.isCM ?? false);
      });
    },
    async advance(milliseconds) {
      await act(async () => t.mock.timers.tick(milliseconds));
    },
    navigate(nextPathname) {
      dom.window.history.pushState({}, '', nextPathname);
    },
    async settleFirstPlay() {
      assert.equal(firstPlayPending, true);
      await act(async () => resolveFirstPlay());
    },
  };
}
