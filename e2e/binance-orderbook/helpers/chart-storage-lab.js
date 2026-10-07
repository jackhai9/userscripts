import { readFile } from 'node:fs/promises';

export const STORAGE_LAB_ORIGIN = 'https://chart-storage.test';
const configuredContexts = new WeakSet();
const fixtureRoot = new URL('../../../test/fixtures/binance-chart-storage/', import.meta.url);
const adapterUrl = new URL('../../../experiments/binance-chart-storage/adapter.js', import.meta.url);
const captureUrl = new URL('../../../experiments/binance-chart-storage/capture.js', import.meta.url);
const bootstrapUrl = new URL('../../../experiments/binance-chart-storage/bootstrap.js', import.meta.url);
const preflightUrl = new URL('../../../experiments/binance-chart-storage/preflight.js', import.meta.url);
const pageHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Storage Lab</title><style>
body{font:16px system-ui;margin:48px;max-width:1080px;color:#142338;background:#f3f6fa}
h1{font-size:36px}p{line-height:1.6}pre{background:white;padding:24px;border:1px solid #c9d4e3;white-space:pre-wrap}
</style></head><body><h1>Storage Lab</h1>
<p>Isolated Chromium · real IndexedDB · public localForage fixture · all external requests blocked</p>
<pre id="result">Ready for an isolated chart-storage experiment.</pre>
<script src="/webpack-runtime.js"></script><script src="/localforage-module.js"></script>
</body></html>`;

/** Count native database operations without replacing the storage workflow. */
function installNativeObservation() {
  const nativeTransaction = IDBDatabase.prototype.transaction;
  const nativePut = IDBObjectStore.prototype.put;
  const nativeGet = IDBObjectStore.prototype.get;
  const nativeOpen = IDBFactory.prototype.open;
  const isTarget = name => name === 'chart_futures' || name === 'chart_delivery';
  const connections = new Map();
  const state = {
    enabled: false,
    abortNextPut: false,
    transactions: 0,
    puts: 0,
    gets: 0,
    opens: 0,
    completed: 0,
    aborted: 0,
    pending: 0,
    versionChanges: 0,
  };
  IDBDatabase.prototype.transaction = function (...args) {
    const transaction = nativeTransaction.apply(this, args);
    if (isTarget(this.name) && !connections.has(this)) {
      connections.set(this, this.version);
      this.addEventListener('versionchange', () => {
        if (state.enabled) state.versionChanges += 1;
      });
    }
    if (state.enabled && isTarget(this.name)) {
      state.transactions += 1;
      state.pending += 1;
      transaction.addEventListener('complete', () => {
        state.completed += 1;
        state.pending -= 1;
      }, { once: true });
      transaction.addEventListener('abort', () => {
        state.aborted += 1;
        state.pending -= 1;
      }, { once: true });
    }
    return transaction;
  };
  IDBObjectStore.prototype.put = function (...args) {
    const request = nativePut.apply(this, args);
    if (state.enabled && isTarget(this.transaction.db.name)) state.puts += 1;
    if (state.abortNextPut && isTarget(this.transaction.db.name)) {
      state.abortNextPut = false;
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
    }
    return request;
  };
  IDBObjectStore.prototype.get = function (...args) {
    if (state.enabled && isTarget(this.transaction.db.name)) state.gets += 1;
    return nativeGet.apply(this, args);
  };
  IDBFactory.prototype.open = function (...args) {
    if (state.enabled && isTarget(args[0])) state.opens += 1;
    return nativeOpen.apply(this, args);
  };
  window.__STORAGE_NATIVE__ = {
    snapshot: () => ({ ...state }),
    reset() {
      Object.assign(state, {
        enabled: true, abortNextPut: false, transactions: 0, puts: 0,
        gets: 0, opens: 0, completed: 0, aborted: 0, pending: 0,
        versionChanges: 0,
      });
    },
    abortNextPut() { state.abortNextPut = true; },
    closeTarget(name) {
      let count = 0;
      for (const database of connections.keys()) {
        if (database.name === name) {
          database.close();
          count += 1;
        }
      }
      return count;
    },
    version(name) {
      return Math.max(...[...connections].filter(([database]) => database.name === name).map(([, version]) => version));
    },
  };
}

/** The context owns every request, including runtime attempts to load remote chunks. */
async function configureContext(context) {
  if (configuredContexts.has(context)) return;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== STORAGE_LAB_ORIGIN) return route.abort('blockedbyclient');
    if (url.pathname === '/' || url.pathname === '/empty') {
      return route.fulfill({
        contentType: 'text/html',
        body: url.pathname === '/empty'
          ? pageHtml.replace('<script src="/webpack-runtime.js"></script><script src="/localforage-module.js"></script>', '')
          : url.searchParams.has('capture')
          ? pageHtml.replace('<script src="/localforage-module.js"></script>', '')
          : pageHtml,
      });
    }
    const asset = {
      '/webpack-runtime.js': new URL('webpack-runtime.js', fixtureRoot),
      '/localforage-module.js': new URL('localforage-module.js', fixtureRoot),
      '/adapter.js': adapterUrl,
      '/capture.js': captureUrl,
      '/bootstrap.js': bootstrapUrl,
      '/preflight.js': preflightUrl,
    }[url.pathname];
    if (!asset) return route.abort('blockedbyclient');
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(asset, 'utf8') });
  });
  await context.addInitScript(installNativeObservation);
  configuredContexts.add(context);
}

/** Registration precedes the host's first require, preserving the real runtime cache. */
export async function initializeStorageLab(page, { install = true, options = {}, captureInstalled = false } = {}) {
  await page.evaluate(async ({ install, options, captureInstalled }) => {
    let runtimeRequire;
    self.webpackChunkfutures_trade_ui.push([
      ['codex-chart-storage-host'], {}, require => { runtimeRequire = require; },
    ]);
    if (typeof runtimeRequire !== 'function') throw new Error('The real runtime did not expose require');
    const originalFactory = runtimeRequire.m[43917];
    let factoryExecutions = 0;
    runtimeRequire.m[43917] = function (...args) {
      factoryExecutions += 1;
      return originalFactory.apply(this, args);
    };
    const hostLocalforage = runtimeRequire(43917);
    const nativeCreateInstance = captureInstalled
      ? window.__STORAGE_CAPTURE_NATIVE_CREATE__
      : hostLocalforage.createInstance;
    const native = nativeCreateInstance.call(hostLocalforage, {
      name: 'chart_futures', storeName: 'keyvaluepairs', driver: hostLocalforage.INDEXEDDB,
    });
    window.__STORAGE_LAB__ = {
      localforage: hostLocalforage,
      nativeCreateInstance,
      native,
      cacheIdentity() {
        return {
          sameExport: runtimeRequire(43917) === hostLocalforage,
          factoryExecutions,
        };
      },
      create(name = 'chart_futures', extra = {}) {
        return hostLocalforage.createInstance({
          name, storeName: 'keyvaluepairs', driver: hostLocalforage.INDEXEDDB, ...extra,
        });
      },
      controller: captureInstalled
        ? window.__STORAGE_CAPTURE_CONTROLLER__
        : install ? (await import('/adapter.js')).installChartStoragePrototype(hostLocalforage, options) : null,
    };
  }, { install, options, captureInstalled });
}

export async function openStorageLab(page, { capture = false, captureInstall = false, initialize = true, ...options } = {}) {
  await configureContext(page.context());
  await page.goto(`${STORAGE_LAB_ORIGIN}/${capture ? '?capture=1' : ''}`);
  if (capture) {
    await page.evaluate(async ({ captureInstall, options }) => {
      const { observeChartStorageModule } = await import('/capture.js');
      window.__STORAGE_CAPTURE_ORIGINAL_PUSH__ = self.webpackChunkfutures_trade_ui.push;
      if (captureInstall) {
        const { installChartStoragePrototype } = await import('/adapter.js');
        window.__STORAGE_CAPTURE__ = observeChartStorageModule(undefined, {
          onCapture(localforage) {
            window.__STORAGE_CAPTURE_NATIVE_CREATE__ = localforage.createInstance;
            window.__STORAGE_CAPTURE_CONTROLLER__ = installChartStoragePrototype(localforage, options);
          },
        });
      } else {
        window.__STORAGE_CAPTURE__ = observeChartStorageModule();
      }
    }, { captureInstall, options: options.options || {} });
    if (!initialize) {
      await page.evaluate(() => {
        const queue = self.webpackChunkfutures_trade_ui;
        const observedPush = queue.push;
        window.__STORAGE_CAPTURE_OBSERVED_PUSH__ = observedPush;
        queue.push = function (chunk) {
          if (Object.hasOwn(chunk[1], '43917')) window.__STORAGE_ORIGINAL_MODULE_FACTORY__ = chunk[1][43917];
          return observedPush.call(this, chunk);
        };
      });
    }
    await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/localforage-module.js` });
    if (!initialize) {
      await page.evaluate(() => {
        self.webpackChunkfutures_trade_ui.push = window.__STORAGE_CAPTURE_OBSERVED_PUSH__;
      });
    }
  }
  if (initialize) await initializeStorageLab(page, { ...options, captureInstalled: captureInstall });
}

/** Failure scenarios register their own bounded module boundary into the real runtime. */
export async function openStorageRuntime(page) {
  await configureContext(page.context());
  await page.goto(`${STORAGE_LAB_ORIGIN}/?capture=1`);
}

/** Startup integration scenarios install capture before either real host script. */
export async function openEmptyStorageLab(page) {
  await configureContext(page.context());
  await page.goto(`${STORAGE_LAB_ORIGIN}/empty`);
}

export async function displayStorageResult(page, result) {
  await page.locator('#result').evaluate((element, value) => {
    element.textContent = JSON.stringify(value, null, 2);
  }, result);
}
