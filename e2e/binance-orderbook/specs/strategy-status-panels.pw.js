import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect, reloadPageWithCoverage } from '../test.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installSimulatedVisibility, setSimulatedVisibility } from '../helpers/simulated-visibility.js';

const fixtureOrigin = 'https://strategy-status.example.test';
const scripts = await Promise.all([
  ['27', 'binance-strategy27-events'], ['31', 'binance-strategy31-volume-reversal'],
].map(async ([id, name]) => {
  const source = await readFile(new URL(`../../../scripts/${name}.user.js`, import.meta.url), 'utf8');
  return { id, name, source, sha256: createHash('sha256').update(source).digest('hex') };
}));
const selectors = { 27: '#jh-strategy27-event-status', 31: '#jh-strategy31-status' };
const text = {
  'zh-CN': { 27: 'Strategy 27 仅在 1 秒图表启用', 31: '策略31：不支持的图表周期' },
  en: { 27: 'Strategy 27 requires a one-second chart', 31: 'Strategy31: unsupported interval' },
};
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body { margin:0; width:100%; height:100%; background:#f5f7fa; color:#343b46; font:14px system-ui; }
  h1 { margin:22px 28px 8px; font-size:20px; }
  p { margin:0 28px; color:#667085; }
  .chart-widget-root { position:fixed; top:94px; right:20px; bottom:20px; left:20px; border:1px solid #d9e0e8; }
  iframe { display:block; width:100%; height:100%; border:0; background:white; }
</style></head><body><h1>Independent strategy status panels</h1>
<p>Monthly chart fixture · light background · separate script preferences</p>
<div class="chart-widget-root"><iframe title="Interactive chart" srcdoc="<!doctype html><html><head><style>
  html,body { margin:0; height:100%; font:14px system-ui; color:#657081; }
  body { background-color:#fff; background-image:linear-gradient(#edf1f5 1px,transparent 1px),linear-gradient(90deg,#edf1f5 1px,transparent 1px); background-size:80px 60px; }
  p { margin:24px; }
  button { position:fixed; bottom:28px; left:28px; padding:10px 16px; border:1px solid #b8c3d1; border-radius:6px; background:#eef3f8; color:#344054; }
</style></head><body><p>BTRUSDT · Monthly</p><button onclick='document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)'>Chart control</button></body></html>"></iframe></div>
</body></html>`;

/** The chart boundary follows the existing native host subscription contract; no strategy method is replaced. */
function installStatusBoundary() {
  function subscription() {
    const callbacks = new Map();
    return {
      subscribe(owner, callback) { callbacks.set(callback, owner); },
      unsubscribe(owner, callback) {
        if (callbacks.get(callback) !== owner) throw new Error('Chart subscription owner mismatch');
        callbacks.delete(callback);
      },
      emit() { for (const callback of [...callbacks.keys()]) callback(); },
      get size() { return callbacks.size; },
    };
  }
  const interval = subscription();
  const loaded = subscription();
  let resolution = '1M';
  const chart = {
    hasModel: () => true, dataReady: () => true,
    resolution: () => resolution, symbol: () => 'BTRUSDT@PRICETYPE=LAST',
    onIntervalChanged: () => interval, onDataLoaded: () => loaded,
  };
  document.querySelector('iframe').contentWindow.tradingViewApi = { activeChart: () => chart };
  const stores = {};
  for (const id of ['27', '31']) {
    const positionKey = `strategy${id}StatusPosition`;
    const prefix = `status-fixture:${id}:`;
    const reads = [];
    const writes = [];
    const menus = new Map();
    let nextMenu = 0;
    stores[id] = {
      reads, writes, menus,
      getValue(key, initial) {
        reads.push(key);
        const raw = localStorage.getItem(prefix + key);
        return raw === null ? initial : JSON.parse(raw);
      },
      setValue(key, value) {
        if (key !== positionKey) throw new Error('Unexpected strategy preference write');
        writes.push({ key, value: structuredClone(value) });
        localStorage.setItem(prefix + key, JSON.stringify(value));
      },
      registerMenu(label, callback, options) {
        const menuId = options === undefined ? ++nextMenu : options.id;
        menus.set(menuId, { label, callback });
        return menuId;
      },
      position() {
        const raw = localStorage.getItem(prefix + positionKey);
        return raw === null ? null : JSON.parse(raw);
      },
    };
  }
  const pointers = new Map();
  const resizeEvents = [];
  window.addEventListener('resize', () => {
    resizeEvents.push({ phase: window.__STATUS_FIXTURE__.phase, width: innerWidth, height: innerHeight,
      statuses: [...document.querySelectorAll('#jh-strategy27-event-status,#jh-strategy31-status')].map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.id, left: node.style.left, top: node.style.top, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }) });
  });
  document.addEventListener('pointerdown', event => {
    if (['jh-strategy27-event-status', 'jh-strategy31-status'].includes(event.target.id)) {
      pointers.set(event.target.id, { node: event.target, pointerId: event.pointerId });
    }
  }, true);
  window.__STATUS_FIXTURE__ = {
    stores, chart, interval, loaded, pointers, resizeEvents, phase: 'installed', remoteRequests: 0,
    setResolution(value) { resolution = value; interval.emit(); loaded.emit(); },
    snapshot() {
      return {
        reads: Object.fromEntries(Object.entries(stores).map(([id, store]) => [id, store.reads.filter(key => key === `strategy${id}StatusPosition`).length])),
        writes: Object.fromEntries(Object.entries(stores).map(([id, store]) => [id, [...store.writes]])),
        positions: Object.fromEntries(Object.entries(stores).map(([id, store]) => [id, store.position()])),
        capture: Object.fromEntries([...pointers].map(([id, value]) => [id, value.node.hasPointerCapture(value.pointerId)])),
        subscriptions: { interval: interval.size, loaded: loaded.size },
        remoteRequests: this.remoteRequests,
      };
    },
  };
}

async function installScripts(page) {
  await page.evaluate(installStatusBoundary);
  for (const script of scripts) {
    await page.addScriptTag({ content: `{
      const unsafeWindow = window;
      const boundary = window.__STATUS_FIXTURE__.stores[${JSON.stringify(script.id)}];
      const GM_getValue = boundary.getValue;
      const GM_setValue = boundary.setValue;
      const GM_registerMenuCommand = boundary.registerMenu;
      const GM_xmlhttpRequest = () => {
        window.__STATUS_FIXTURE__.remoteRequests += 1;
        throw new Error('Inactive chart status must not request a gateway');
      };
      ${script.source}
    }` });
  }
}

async function openHost(page, locale) {
  const errors = [];
  const unexpectedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await installScenarioClock(page);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === fixtureOrigin && url.pathname.endsWith('/futures/BTRUSDT')) {
      await route.fulfill({ contentType: 'text/html', body: html });
    } else {
      unexpectedRequests.push(url.href);
      await route.abort();
    }
  });
  await page.goto(`${fixtureOrigin}/${locale}/futures/BTRUSDT`);
  await expect(page.frameLocator('iframe').getByRole('button', { name: 'Chart control' })).toBeVisible();
  await pauseScenarioClock(page);
  return { errors, unexpectedRequests };
}

async function drag(page, id, position, { release = true } = {}) {
  await page.evaluate(value => { window.__STATUS_FIXTURE__.phase = value; }, `drag-${id}`);
  const box = await page.locator(selectors[id]).boundingBox();
  if (!box) throw new Error('Status must be visible before a drag');
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(position.left + 12, position.top + box.height / 2, { steps: 5 });
  if (release) await page.mouse.up();
}

async function snapshot(page) {
  return page.evaluate(() => window.__STATUS_FIXTURE__.snapshot());
}

async function geometry(page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport.width, visualHeight: visualViewport.height },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, fonts: document.fonts.status },
    statuses: [...document.querySelectorAll('#jh-strategy27-event-status,#jh-strategy31-status')].map(node => {
      const rect = node.getBoundingClientRect();
      return { id: node.id, left: node.style.left, top: node.style.top, right: node.style.right, bottom: node.style.bottom,
        x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
    resizeEvents: window.__STATUS_FIXTURE__.resizeEvents,
  }));
}

async function expectDraggedStatusGeometry(page) {
  for (const [id, top] of [['27', 150], ['31', 220]]) {
    await expect(page.locator(selectors[id])).toHaveCSS('left', '80px');
    await expect(page.locator(selectors[id])).toHaveCSS('top', `${top}px`);
    const box = await page.locator(selectors[id]).boundingBox();
    expect({ x: box.x, y: box.y }).toEqual({ x: 80, y: top });
  }
}

async function writeEvidence(testInfo, name, value) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

/** Inspect the captured pixels independently of DOM geometry and saved preference assertions. */
async function statusPixels(page, screenshot) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const samples = [['27', 84, 166], ['31', 84, 236]].map(([id, x, y]) => ({
      id, x, y, rgba: [...context.getImageData(x, y, 1, 1).data],
    }));
    bitmap.close();
    return samples;
  }, screenshot.toString('base64'));
}

test('user chart boundary preserves subscription ownership and script-private GM values', async ({ page }) => {
  // Given a native chart boundary before either generated strategy is installed
  const h = await openHost(page, 'en');
  await page.evaluate(installStatusBoundary);

  // When independent listeners subscribe, emit and release while both scripts persist their positions
  const evidence = await page.evaluate(() => {
    const host = window.__STATUS_FIXTURE__;
    const counts = { interval: 0, loaded: 0 };
    const owner = {};
    const onInterval = () => { counts.interval += 1; };
    const onLoaded = () => { counts.loaded += 1; };
    host.interval.subscribe(owner, onInterval);
    host.loaded.subscribe(owner, onLoaded);
    host.setResolution('2M');
    host.interval.unsubscribe(owner, onInterval);
    host.loaded.unsubscribe(owner, onLoaded);
    host.setResolution('1M');
    host.stores['27'].setValue('strategy27StatusPosition', { left: 100, top: 120 });
    host.stores['31'].setValue('strategy31StatusPosition', { left: 240, top: 300 });
    return { counts, chart: { resolution: host.chart.resolution(), symbol: host.chart.symbol(), ready: host.chart.dataReady() },
      absent31In27: host.stores['27'].getValue('strategy31StatusPosition', null),
      absent27In31: host.stores['31'].getValue('strategy27StatusPosition', null), snapshot: host.snapshot() };
  });

  // Then each callback runs once and neither script's private GM namespace exposes the other's position
  expect(evidence.counts).toEqual({ interval: 1, loaded: 1 });
  expect(evidence.chart).toEqual({ resolution: '1M', symbol: 'BTRUSDT@PRICETYPE=LAST', ready: true });
  expect(evidence.snapshot.subscriptions).toEqual({ interval: 0, loaded: 0 });
  expect(evidence.snapshot.positions).toEqual({ 27: { left: 100, top: 120 }, 31: { left: 240, top: 300 } });
  expect(evidence.absent31In27).toBeNull();
  expect(evidence.absent27In31).toBeNull();
  expect(h.errors).toEqual([]);
  expect(h.unexpectedRequests).toEqual([]);
});

for (const locale of ['zh-CN', 'en']) {
  test(`user drags and restores independent readable strategy statuses in ${locale}`, async ({ page }, testInfo) => {
    // Given both complete generated scripts show independent statuses over a light chart iframe
    const h = await openHost(page, locale);
    await installScripts(page);
    for (const id of ['27', '31']) {
      await expect(page.locator(selectors[id])).toHaveText(text[locale][id]);
      await expect(page.locator(selectors[id])).toHaveCSS('background-color', 'rgb(24, 26, 32)');
      await expect(page.locator(selectors[id])).toHaveCSS('color', 'rgb(221, 221, 221)');
    }
    await expect(page.locator(selectors[27])).toHaveAttribute('data-state', 'inactive');
    await expect(page.locator(selectors[31])).toHaveAttribute('data-state', 'normal');
    const initial31 = await page.locator(selectors[31]).boundingBox();

    // When Strategy27 is dragged across the iframe before the separate Strategy31 drag
    await drag(page, '27', { left: 80, top: 150 });
    const after27 = await snapshot(page);

    // Then only Strategy27 saves a position and Strategy31 remains at its own default location
    expect(after27.writes).toEqual({ 27: [{ key: 'strategy27StatusPosition', value: { left: 80, top: 150 } }], 31: [] });
    expect(await page.locator(selectors[31]).boundingBox()).toEqual(initial31);

    // When Strategy31 moves independently and the user releases the pointer above the chart
    await drag(page, '31', { left: 80, top: 220 });
    await page.evaluate(() => { window.__STATUS_FIXTURE__.phase = 'chart-click'; });
    await page.frameLocator('iframe').getByRole('button', { name: 'Chart control' }).click();

    // Then each script owns one saved position and real pointer capture has released the chart
    const state = await snapshot(page);
    expect(state.reads).toEqual({ 27: 1, 31: 1 });
    expect(state.positions).toEqual({ 27: { left: 80, top: 150 }, 31: { left: 80, top: 220 } });
    expect(state.writes['27']).toHaveLength(1);
    expect(state.writes['31']).toEqual([{ key: 'strategy31StatusPosition', value: { left: 80, top: 220 } }]);
    expect(state.capture).toEqual({ 'jh-strategy27-event-status': false, 'jh-strategy31-status': false });
    await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-clicks', '1');
    await page.evaluate(() => { window.__STATUS_FIXTURE__.phase = 'screenshot'; });
    const beforeScreenshot = await geometry(page);
    await writeEvidence(testInfo, 'geometry-before-screenshot', beforeScreenshot);
    await expectDraggedStatusGeometry(page);
    const screenshot = testInfo.outputPath(`strategy-status-${locale}.png`);
    /** Full-page capture exposes a temporary 1px viewport to resize listeners in this Chromium fixture. */
    const screenshotBytes = await page.screenshot({ path: screenshot, fullPage: false, scale: 'css' });
    const afterScreenshot = await geometry(page);
    await writeEvidence(testInfo, 'geometry-after-screenshot', afterScreenshot);
    await expectDraggedStatusGeometry(page);
    expect(afterScreenshot.viewport).toEqual(beforeScreenshot.viewport);
    expect(afterScreenshot.statuses).toEqual(beforeScreenshot.statuses);
    expect(afterScreenshot.resizeEvents).toEqual(beforeScreenshot.resizeEvents);
    const pixels = await statusPixels(page, screenshotBytes);
    await writeEvidence(testInfo, 'status-pixels', pixels);
    expect(pixels).toEqual([
      { id: '27', x: 84, y: 166, rgba: [24, 26, 32, 255] },
      { id: '31', x: 84, y: 236, rgba: [24, 26, 32, 255] },
    ]);
    await testInfo.attach(`strategy-status-${locale}`, { path: screenshot, contentType: 'image/png' });
    await testInfo.attach('generated-sources', { body: Buffer.from(JSON.stringify(scripts.map(({ id, name, sha256 }) => ({ id, name, sha256 })))), contentType: 'application/json' });

    // When a real page reload starts both generated entrypoints against the same private GM stores
    await reloadPageWithCoverage(page);
    await installScripts(page);

    // Then both positions restore without generating a new position write
    await expect(page.locator(selectors[27])).toHaveCSS('left', '80px');
    await expect(page.locator(selectors[27])).toHaveCSS('top', '150px');
    await expect(page.locator(selectors[31])).toHaveCSS('left', '80px');
    await expect(page.locator(selectors[31])).toHaveCSS('top', '220px');
    expect((await snapshot(page)).writes).toEqual({ 27: [], 31: [] });

    // When the user places both statuses near the viewport edges before shrinking the window
    await drag(page, '27', { left: 1050, top: 520 });
    await drag(page, '31', { left: 1100, top: 900 });
    const beforeResize = await snapshot(page);
    const beforeResizeGeometry = await geometry(page);
    await page.evaluate(() => {
      window.__STATUS_FIXTURE__.resizeCompleted = new Promise(resolve => {
        window.addEventListener('resize', () => resolve(), { once: true });
      });
    });
    await page.setViewportSize({ width: 900, height: 650 });
    await page.evaluate(() => window.__STATUS_FIXTURE__.resizeCompleted);

    // Then both statuses stay readable and inside the viewport without changing the saved positions
    for (const id of ['27', '31']) {
      const box = await page.locator(selectors[id]).boundingBox();
      const before = beforeResizeGeometry.statuses.find(status => status.id === selectors[id].slice(1));
      expect(box.width).toBeCloseTo(before.width, 2);
      expect(box.height).toBeCloseTo(before.height, 2);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(900.01);
      expect(box.y + box.height).toBeLessThanOrEqual(650.01);
    }
    await page.screenshot({ path: testInfo.outputPath(`strategy-status-resized-${locale}.png`), fullPage: false });
    expect((await snapshot(page)).writes).toEqual(beforeResize.writes);
    expect((await snapshot(page)).positions).toEqual(beforeResize.positions);
    expect(h.errors).toEqual([]);
    expect(h.unexpectedRequests).toEqual([]);
  });
}

test('user keeps status updates silent and releases dragging on route departure disposal and unload', async ({ page }) => {
  // Given both real generated strategies are installed with a controllable background-tab boundary
  const h = await openHost(page, 'en');
  await installScripts(page);
  await installSimulatedVisibility(page);
  await page.evaluate(() => {
    window.__STATUS_FIXTURE__.original27 = document.getElementById('jh-strategy27-event-status');
    window.__STATUS_FIXTURE__.original31 = document.getElementById('jh-strategy31-status');
  });

  // When hidden-page timers and repeated language changes update the existing statuses
  await setSimulatedVisibility(page, true);
  await page.clock.runFor(10_000);
  await page.evaluate(() => {
    for (let index = 0; index < 8; index += 1) {
      history.pushState({}, '', `/${index % 2 === 0 ? 'zh-CN' : 'en'}/futures/BTRUSDT`);
    }
  });

  // Then the same DOM nodes remain and neither status updates nor inactive sampling save preferences
  expect(await page.evaluate(() => ({
    same27: document.getElementById('jh-strategy27-event-status') === window.__STATUS_FIXTURE__.original27,
    same31: document.getElementById('jh-strategy31-status') === window.__STATUS_FIXTURE__.original31,
  }))).toEqual({ same27: true, same31: true });
  expect((await snapshot(page)).reads).toEqual({ 27: 1, 31: 1 });
  expect((await snapshot(page)).writes).toEqual({ 27: [], 31: [] });
  expect((await snapshot(page)).remoteRequests).toBe(0);

  // When navigation leaves the trading route during a real Strategy27 pointer drag
  await setSimulatedVisibility(page, false);
  await drag(page, '27', { left: 240, top: 170 }, { release: false });
  expect((await snapshot(page)).capture['jh-strategy27-event-status']).toBe(true);
  await page.evaluate(() => history.pushState({}, '', '/en/futures/'));
  await page.mouse.up();

  // Then both statuses disappear and detached drag listeners neither retain capture nor write positions
  await expect(page.locator(selectors[27])).toHaveCount(0);
  await expect(page.locator(selectors[31])).toHaveCount(0);
  expect((await snapshot(page)).capture['jh-strategy27-event-status']).toBe(false);
  expect((await snapshot(page)).writes).toEqual({ 27: [], 31: [] });

  // When a language-only return precedes the next normal Strategy31 sample
  await page.evaluate(() => history.pushState({}, '', '/zh-CN/futures/BTRUSDT'));

  // Then Strategy31 stays removed until sampling resumes while Strategy27 reports its inactive chart
  await expect(page.locator(selectors[31])).toHaveCount(0);
  await expect(page.locator(selectors[27])).toHaveText(text['zh-CN'][27]);

  // When normal sampling resumes and a completed drag follows the repeated status updates
  await page.evaluate(() => window[Symbol.for('jh-userscripts.strategy31')].sample());
  await drag(page, '27', { left: 80, top: 150 });

  // Then exactly one listener-driven save occurs and Strategy31 returns without rereading preferences
  expect((await snapshot(page)).writes['27']).toEqual([{ key: 'strategy27StatusPosition', value: { left: 80, top: 150 } }]);
  expect((await snapshot(page)).reads).toEqual({ 27: 1, 31: 1 });
  await expect(page.locator(selectors[31])).toHaveText(text['zh-CN'][31]);

  // When Strategy31 is disposed during its own real pointer drag
  await drag(page, '31', { left: 350, top: 280 }, { release: false });
  expect((await snapshot(page)).capture['jh-strategy31-status']).toBe(true);
  await page.evaluate(() => window[Symbol.for('jh-userscripts.strategy31')].dispose());
  await page.mouse.up();

  // Then only Strategy31 disappears and its pointer capture and native subscriptions are released
  await expect(page.locator(selectors[31])).toHaveCount(0);
  await expect(page.locator(selectors[27])).toBeVisible();
  expect((await snapshot(page)).capture['jh-strategy31-status']).toBe(false);
  expect((await snapshot(page)).subscriptions).toEqual({ interval: 0, loaded: 0 });
  expect((await snapshot(page)).writes['31']).toEqual([]);

  // When unload fires during a new Strategy27 drag and later timer or route events still arrive
  await drag(page, '27', { left: 450, top: 320 }, { release: false });
  expect((await snapshot(page)).capture['jh-strategy27-event-status']).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  await page.mouse.up();
  await page.clock.runFor(10_000);
  await page.evaluate(() => history.pushState({}, '', '/en/futures/BTRUSDT'));
  await page.frameLocator('iframe').getByRole('button', { name: 'Chart control' }).click();

  // Then no status is revived, no unfinished drag is saved and the chart remains interactive
  await expect(page.locator(selectors[27])).toHaveCount(0);
  await expect(page.locator(selectors[31])).toHaveCount(0);
  expect((await snapshot(page)).capture).toEqual({ 'jh-strategy27-event-status': false, 'jh-strategy31-status': false });
  expect((await snapshot(page)).writes).toEqual({ 27: [{ key: 'strategy27StatusPosition', value: { left: 80, top: 150 } }], 31: [] });
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-clicks', '1');
  expect(h.errors).toEqual([]);
  expect(h.unexpectedRequests).toEqual([]);
});
