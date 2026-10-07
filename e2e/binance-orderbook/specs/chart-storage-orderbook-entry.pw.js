import { readFile } from 'node:fs/promises';
import { test, expect } from '../test.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const INPUT = '#jh-binance-close-qty-multiplier-input';

test('user gets one working orderbook when document-start injection precedes the document root', async ({ page }) => {
  // Given the real artifact runs once through the browser init-script boundary before any fixture HTML.
  await page.route('**/*', route => route.abort('blockedbyclient'));
  const errors = [];
  page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack }));
  const source = await readFile(new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url), 'utf8');
  await page.addInitScript({ content: `
    window.__EARLY_ORDERBOOK_ENTRY__ = {
      documentRootPresent: Boolean(document.documentElement),
      injections: 1,
      fixtureScriptLoads: 0,
    };
    ${source}
  ` });
  let initial;

  // When the normal host HTML arrives with its later copy of the artifact explicitly disabled.
  const host = await openUserscriptScenario(page, createCancelScenario(), {
    beforeOrderbook: 'window.__EARLY_ORDERBOOK_ENTRY__.fixtureScriptLoads += 1; if (false) {',
    afterOrderbook: '}',
    afterNavigation: async () => {
      initial = await page.evaluate(() => ({
        entry: window.__EARLY_ORDERBOOK_ENTRY__,
        storageInstalled: Object.hasOwn(self, '__BINANCE_CHART_STORAGE__'),
        queueIntercepted: typeof Object.getOwnPropertyDescriptor(self.webpackChunkfutures_trade_ui, 'push').get === 'function',
      }));
      expect(errors, 'The initial artifact must complete without a later reinjection repairing it').toEqual([]);
    },
  });
  const disabledStyle = await page.locator('#jh-binance-close-qty-multiplier-dec').evaluate(element => {
    const style = getComputedStyle(element);
    return { disabled: element.disabled, background: style.backgroundColor, cursor: style.cursor };
  });
  await page.locator(INPUT).fill('3');
  await page.locator(INPUT).blur();

  // Then the first injection owns storage and initializes exactly one usable panel after the root appears.
  expect(initial).toEqual({ entry: { documentRootPresent: false, injections: 1, fixtureScriptLoads: 1 }, storageInstalled: true, queueIntercepted: true });
  expect(await page.evaluate(() => typeof window.__TM_CLOSE_LONG_DEBUG__)).toBe('object');
  await expect(page.locator('style#jh-disabled-control-style')).toHaveCount(1);
  expect(disabledStyle).toEqual({ disabled: true, background: 'rgb(245, 245, 245)', cursor: 'not-allowed' });
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(INPUT)).toHaveValue('3');
  await expect(page.locator('#jh-binance-close-qty-final')).toHaveText('0.21');
  expect(errors).toEqual([]);
  expect(host.errors).toEqual([]);
  expect((await readFixtureState(page)).events.filter(({ type }) => ['order-submitted', 'cancel-requested'].includes(type))).toEqual([]);
});

test('user installs chart storage before the generated orderbook starts its native network observation', async ({ page }) => {
  // Given every request is isolated and a native constructor read records the first business initialization.
  await page.route('**/*', route => route.abort('blockedbyclient'));
  const observeStartup = `
    {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'WebSocket');
      let value = window.WebSocket;
      window.__CHART_ENTRY_OBSERVATIONS__ = [];
      window.__RESTORE_ENTRY_OBSERVATION__ = () => Object.defineProperty(window, 'WebSocket', { ...descriptor, value });
      Object.defineProperty(window, 'WebSocket', {
        configurable: true,
        get() {
          const queue = self.webpackChunkfutures_trade_ui;
          const push = queue && Object.getOwnPropertyDescriptor(queue, 'push');
          window.__CHART_ENTRY_OBSERVATIONS__.push({
            storageInstalled: Object.hasOwn(self, '__BINANCE_CHART_STORAGE__'),
            queueIntercepted: Boolean(push && typeof push.get === 'function'),
            bookDebug: typeof window.__TM_CLOSE_LONG_DEBUG__,
            readyState: document.readyState,
          });
          return value;
        },
        set(next) { value = next; },
      });
    }
  `;

  // When the unchanged generated install artifact starts on the existing full orderbook host fixture.
  const host = await openUserscriptScenario(page, createCancelScenario(), {
    beforeOrderbook: observeStartup,
    afterOrderbook: 'window.__RESTORE_ENTRY_OBSERVATION__();',
  });
  const first = await page.evaluate(() => window.__CHART_ENTRY_OBSERVATIONS__[0]);

  // Then queue interception precedes the first business network observer and the normal panel still mounts.
  expect(first).toEqual({ storageInstalled: true, queueIntercepted: true, bookDebug: 'undefined', readyState: 'loading' });
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(INPUT)).toHaveValue('1');
  expect(host.errors).toEqual([]);
});

for (const kind of ['source-mismatch', 'late-bootstrap']) {
  test(`user can edit the orderbook multiplier when chart storage retires after ${kind}`, async ({ page }) => {
    // Given the fixture supplies either an unsupported host module or an already populated native queue.
    await page.route('**/*', route => route.abort('blockedbyclient'));
    const beforeOrderbook = `
      self.__CHART_ENTRY_NATIVE_FACTORY__ = function nativeHost(module) { module.exports = 'native-chart-module'; };
      self.__CHART_ENTRY_NATIVE_CHUNK__ = [['existing-chart'], { 70940: self.__CHART_ENTRY_NATIVE_FACTORY__ }];
      self.webpackChunkfutures_trade_ui = ${kind === 'late-bootstrap' ? '[self.__CHART_ENTRY_NATIVE_CHUNK__]' : '[]'};
    `;

    // When the generated orderbook loads and the user edits its real quantity control after storage retires.
    const host = await openUserscriptScenario(page, createCancelScenario(), {
      beforeOrderbook,
      afterOrderbook: kind === 'source-mismatch'
        ? 'self.webpackChunkfutures_trade_ui.push(self.__CHART_ENTRY_NATIVE_CHUNK__);' : '',
    });
    await page.locator(INPUT).fill('3');
    await page.locator(INPUT).blur();
    const storage = await page.evaluate(async () => {
      const snapshot = await self.__BINANCE_CHART_STORAGE__.stop();
      const chunk = self.webpackChunkfutures_trade_ui[0];
      const module = { exports: {} };
      chunk[1][70940](module);
      return {
        snapshot,
        sameChunk: chunk === self.__CHART_ENTRY_NATIVE_CHUNK__,
        sameFactory: chunk[1][70940] === self.__CHART_ENTRY_NATIVE_FACTORY__,
        nativePush: self.webpackChunkfutures_trade_ui.push === Array.prototype.push,
        nativeValue: module.exports,
      };
    });

    // Then native chart execution remains intact and the normal orderbook calculation works without trading.
    expect(storage.snapshot).toMatchObject({ status: 'native', phase: 'stopped',
      reason: kind === 'source-mismatch' ? 'source_mismatch' : 'bootstrap_unavailable',
      attempts: kind === 'source-mismatch' ? 1 : 0, matches: 0, executions: 0,
      writer: { acceptedBatches: 0, transactions: 0 },
    });
    expect(storage).toMatchObject({ sameChunk: true, sameFactory: true,
      nativePush: kind === 'late-bootstrap', nativeValue: 'native-chart-module' });
    expect(storage.snapshot.drawingScope.status).toBe(kind === 'late-bootstrap' ? 'unavailable' : 'waiting');
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(INPUT)).toHaveValue('3');
    await expect(page.locator('#jh-binance-close-qty-final')).toHaveText('0.21');
    expect((await readFixtureState(page)).events.filter(({ type }) => ['order-submitted', 'cancel-requested'].includes(type))).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

test('user keeps storage and the trading panel absent on futures home before native SPA entry', async ({ page }) => {
  // Given the generated artifact starts on the futures homepage despite a stale trading host DOM.
  await page.route('**/*', route => route.abort('blockedbyclient'));
  let homepage;

  // When the existing fixture navigates from home to its supported contract without reinjecting the script.
  const host = await openUserscriptScenario(page, createCancelScenario(), {
    beforeOrderbook: "history.replaceState({}, '', '/zh-CN/futures/home');",
    afterNavigation: async () => {
      homepage = await page.evaluate(() => ({
        pathname: location.pathname,
        storageInstalled: Object.hasOwn(self, '__BINANCE_CHART_STORAGE__'),
        queueCreated: Object.hasOwn(self, 'webpackChunkfutures_trade_ui'),
        bookDebug: typeof window.__TM_CLOSE_LONG_DEBUG__,
        panels: document.querySelectorAll('#jh-binance-close-qty-multiplier-panel').length,
      }));
      await page.evaluate(() => history.pushState({}, '', '/zh-CN/futures/HYPEUSDT'));
    },
  });
  await page.locator(INPUT).fill('3');

  // Then home performed no storage or trading initialization and the unchanged orderbook SPA path still works.
  expect(homepage).toEqual({ pathname: '/zh-CN/futures/home', storageInstalled: false, queueCreated: false, bookDebug: 'undefined', panels: 0 });
  expect(await page.evaluate(() => Object.hasOwn(self, '__BINANCE_CHART_STORAGE__'))).toBe(false);
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('#jh-binance-close-qty-final')).toHaveText('0.21');
  expect((await readFixtureState(page)).events.filter(({ type }) => ['order-submitted', 'cancel-requested'].includes(type))).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user retains the existing orderbook behavior in a child frame while storage remains top-frame only', async ({ page }) => {
  // Given the generated artifact has mounted on a top-level fixture that owns every child-frame request.
  await page.route('**/*', route => route.abort('blockedbyclient'));
  const host = await openUserscriptScenario(page, createCancelScenario());

  // When a real same-origin child trading page loads the same artifact and edits its own multiplier.
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.name = 'chart-storage-entry-child';
    frame.src = '/zh-CN/futures/HYPEUSDT?chart-storage-entry-child=1';
    frame.style.cssText = 'width:1440px;height:1000px;border:0';
    document.body.appendChild(frame);
  });
  const frame = page.frameLocator('iframe[name="chart-storage-entry-child"]');
  await expect(frame.locator(PANEL)).toBeVisible();
  await frame.locator(INPUT).fill('3');
  const state = await frame.locator('body').evaluate(() => ({
    isTop: self === top,
    storageInstalled: Object.hasOwn(self, '__BINANCE_CHART_STORAGE__'),
    queueCreated: Object.hasOwn(self, 'webpackChunkfutures_trade_ui'),
    bookDebug: typeof window.__TM_CLOSE_LONG_DEBUG__,
    actions: window.__BINANCE_FIXTURE__.snapshot().events.filter(({ type }) => ['order-submitted', 'cancel-requested'].includes(type)),
  }));

  // Then only storage is frame-restricted while the original orderbook panel and quantity calculation remain usable.
  expect(state).toEqual({ isTop: false, storageInstalled: false, queueCreated: false, bookDebug: 'object', actions: [] });
  expect(await page.evaluate(() => Object.hasOwn(self, '__BINANCE_CHART_STORAGE__'))).toBe(true);
  await expect(frame.locator(INPUT)).toHaveValue('3');
  await expect(frame.locator('#jh-binance-close-qty-final')).toHaveText('0.21');
  expect(host.errors).toEqual([]);
});
