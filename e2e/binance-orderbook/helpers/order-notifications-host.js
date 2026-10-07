import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { build, transform } from 'esbuild';

import { nativeOrderNotificationSources } from '../../../test/fixtures/binance-order-notifications/original-factories.js';
import { openUserscriptScenario } from './userscript-page.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';

let dependenciesSource;

/** Bundle React dependencies separately from the native factories under test. */
async function readReactDependencies() {
  if (!dependenciesSource) {
    const result = await build({
      stdin: {
        contents: `import * as React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {jsx,jsxs} from 'react/jsx-runtime'; self.__NOTIFICATION_REACT__={React,createRoot,flushSync,jsx,jsxs};`,
        resolveDir: new URL('../../../', import.meta.url).pathname,
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    dependenciesSource = result.outputFiles[0].text;
  }
  return dependenciesSource;
}

/** Native code owns all classification, events, throttles and playback scheduling. */
function installNotificationHost(nativeFactories) {
  const { React, createRoot, flushSync, jsx, jsxs } = self.__NOTIFICATION_REACT__;
  const channels = new Map([[false, new Set()], [true, new Set()]]);
  const audio = [];
  const toasts = [];
  const parameters = Object.freeze({});
  const getSDK = ({ isCM }) => ({
    getUserOrderStream: () => ({
      subscribe(listener) {
        channels.get(isCM).add(listener);
        return () => channels.get(isCM).delete(listener);
      },
    }),
  });
  const emit = (order, isCM) => {
    for (const listener of channels.get(isCM)) listener(order);
  };
  const createExternalStore = (initialize) => {
    const listeners = new Set();
    let state = initialize((change) => {
      state = { ...state, ...change };
      for (const listener of listeners) listener();
    });
    const subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const snapshot = () => state;
    return () => React.useSyncExternalStore(subscribe, snapshot, snapshot);
  };
  HTMLMediaElement.prototype.load = function load() {
    audio.push({ kind: 'load', pathname: location.pathname });
  };
  HTMLMediaElement.prototype.play = function play() {
    audio.push({ kind: 'play', pathname: location.pathname });
    return Promise.resolve();
  };
  const enqueueNotification = (message, options) => {
    toasts.push({ message, options, pathname: location.pathname });
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    alert.style.cssText = 'padding:16px 24px;margin:8px;background:#102a20;color:#d7ffec;border:1px solid #43b581;border-radius:8px;font:16px system-ui;box-shadow:0 5px 24px #0004';
    document.getElementById('native-order-notifications').appendChild(alert);
  };
  const stores = new Map();
  const queryClient = { setQueryData: (key, update) => stores.set(key, update(stores.get(key))) };
  const makeBatcher = () => {
    const workers = new Set();
    return {
      addWorker: (worker) => workers.add(worker),
      removeWorker: (worker) => workers.delete(worker),
      push: (order) => {
        for (const worker of workers) worker(Array.isArray(order) ? order : [order]);
      },
    };
  };
  const cmBatcher = makeBatcher();
  const umBatcher = makeBatcher();
  const dependencies = {
    41594: React,
    31085: { jsx, jsxs },
    75510: { _: (array) => [...array] },
    94917: { _: (instance, Constructor) => {
      if (!(instance instanceof Constructor)) throw new TypeError('Expected native constructor invocation');
    } },
    17409: { a0: 'classic', K5: 'https://static.test.invalid' },
    61523: { d4: (selector) => selector({ setting: { layout: 'classic' } }) },
    92873: { o: () => ({ getI18n: (_key, options) => options.defaultValue }) },
    64041: { h: () => ({ enqueueNotification }) },
    51471: { zr: (key) => {
      if (!['open_order_status_toast', 'open-order-notification-sound-open'].includes(key)) throw new Error('Unknown native preference');
      const [data, setData] = React.useState(true);
      return { data, setData, hasInitialized: true };
    } },
    80065: { A: createExternalStore },
    96636: { Z: () => ({ isEUFuturesUrl: false }) },
    16921: { Gw: () => parameters },
    72363: { Ri: getSDK },
    79515: { nH: () => true, Py: () => ({ isExistFutureAccount: true }), ON: () => ({ isPM2: false }) },
    88478: { A: () => null },
    48651: { ud: () => ({ getI18n: (_key, options) => options.defaultValue }) },
    34175: { Zu: () => undefined },
    10157: { XE: 'notification-switch', IG: 'notification-label' },
    87017: {},
    48187: { mp: () => { throw new Error('Notification fixture cannot access financial APIs'); } },
    57861: { post: () => { throw new Error('Notification fixture cannot access financial APIs'); } },
    41466: {},
    43335: { Bz: { OPEN_ORDERS: (isCM) => `orders:${isCM}` } },
    26860: {},
    84266: {},
    90291: {},
    47738: { Y: ({ subscribeToStreamFn }) => (options) => subscribeToStreamFn({
      ...options, stream: options.getSDK({ isCM: options.isCM }),
    }) },
    95541: { CX: cmBatcher, kc: () => umBatcher },
  };
  const hostFactories = Object.fromEntries(Object.entries(dependencies).map(([id, value]) => [id, (module) => { module.exports = value; }]));
  self.webpackChunkfutures_trade_ui.push([['notification-host'], { ...hostFactories, ...nativeFactories }, (require) => {
    const NativeEmitter = require(22584).b;
    const emitter = new NativeEmitter();
    require.m[71822] = (module) => { module.exports = { J: emitter }; };
    const nativeOrders = require(4189);
    for (const isCM of [false, true]) {
      nativeOrders.$t({ enabled: true, isCM, isPM2: false, getSDK, queryClient, copyTradingPayload: parameters });
    }
    const Provider = require(55401).SoundNotificationProvider;
    const Register = require(34122).OrderToastNotifyRegister;
    const mount = () => {
      const presentation = document.createElement('section');
      presentation.id = 'native-order-notifications';
      presentation.setAttribute('aria-label', 'Native order reminders');
      presentation.style.cssText = 'position:fixed;top:24px;right:24px;z-index:2147483646;max-width:410px';
      const rootElement = document.createElement('div');
      rootElement.id = 'native-order-notification-provider';
      document.body.append(presentation, rootElement);
      const root = createRoot(rootElement);
      flushSync(() => root.render(React.createElement(Provider, null, React.createElement(Register))));
      self.__NOTIFICATION_HOST__ = {
        ready: () => channels.get(false).size === 2 && channels.get(true).size === 2,
        notify(symbol, orderId) {
          const order = { symbol, orderId, clientOrderId: `manual-${orderId}`, type: 'LIMIT', orderType: 'LIMIT', origType: 'LIMIT', side: 'BUY', operate: 'TRADE', status: 'FILLED' };
          flushSync(() => {
            emit({ ...order, status: 'NEW' }, false);
            emit(order, false);
          });
        },
        snapshot() {
          flushSync(() => undefined);
          return { audio: [...audio], toasts: [...toasts] };
        },
      };
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }]);
}

/** Install the built artifact at document-start, then enter through the real Rspack queue. */
export async function openNotificationScenario(page, symbol, {
  soundSourceSha256 = '5362a54e61f022714e673e166b62e3c22997084ca7a9f4e676475ec91cfcfaa8',
  repackNativeFactories = false,
} = {}) {
  await page.route('**/*', (route) => route.abort('blockedbyclient'));
  const [artifact, runtime, react] = await Promise.all([
    readFile(new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url), 'utf8'),
    readFile(new URL('../../../test/fixtures/binance-chart-storage/webpack-runtime.js', import.meta.url), 'utf8'),
    readReactDependencies(),
  ]);
  await page.addInitScript({ content: `self.__NOTIFICATION_EARLY_ROOT__=Boolean(document.documentElement);\n${artifact}` });
  const ids = new Set(['30877', '39116', '55401', '40477', '70020', '22584', '34122', '4189']);
  const selectedSources = nativeOrderNotificationSources.filter((entry) => ids.has(entry.id)
    && (entry.id !== '30877' || entry.chunks.includes('37511'))
    && (entry.id !== '39116' || entry.sha256 === soundSourceSha256));
  const factories = Array.from(ids, (id) => {
    const matches = selectedSources.filter((entry) => entry.id === id);
    assert.equal(matches.length, 1, `Notification host requires exactly one native factory for ${id}`);
    return matches[0].source;
  }).join(',\n');
  let factoryObject = `{${factories}}`;
  if (repackNativeFactories) {
    // An independent compiler supplies unseen bindings without using the production matcher.
    const capturedFactories = parse(`(${factoryObject});`, { ecmaVersion: 'latest' }).body[0].expression;
    const { code } = await transform(`(${factoryObject});`, {
      minifyIdentifiers: true,
      minifySyntax: false,
      minifyWhitespace: false,
    });
    const program = parse(code, { ecmaVersion: 'latest' });
    assert.equal(program.body.length, 1, 'Repacked factories must remain one expression');
    const expression = program.body[0].expression;
    assert.equal(expression.type, 'ObjectExpression', 'Repacked factories must remain an object');
    assert.deepEqual(expression.properties.map((property) => String(property.key.value)), [...ids]);
    for (const [index, property] of expression.properties.entries()) {
      const captured = selectedSources.find((entry) => entry.id === String(property.key.value));
      assert.notEqual(code.slice(property.start, property.end), captured.source,
        `Repacking must change the captured source for ${captured.id}`);
      assert.notDeepEqual(property.value.params.map((parameter) => parameter.name),
        capturedFactories.properties[index].value.params.map((parameter) => parameter.name),
        `Repacking must rename factory parameters for ${captured.id}`);
    }
    factoryObject = code.slice(expression.start, expression.end);
  }
  const host = await openUserscriptScenario(page, createCancelScenario({ currentSymbol: symbol }), {
    beforeOrderbook: `${react}\n${runtime}\n(${installNotificationHost.toString()})(${factoryObject});\nif(false){`,
    afterOrderbook: '}',
  });
  await page.waitForFunction(() => self.__NOTIFICATION_HOST__?.ready() === true);
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T12:00:01Z'));
  return host;
}

export async function readNotificationEffects(page) {
  return page.evaluate(() => self.__NOTIFICATION_HOST__.snapshot());
}
