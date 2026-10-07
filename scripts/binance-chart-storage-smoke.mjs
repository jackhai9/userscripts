import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const target = 'https://www.binance.com/zh-CN/futures/USUSDT';
const artifactUrl = new URL('binance-orderbook-trade.user.js', import.meta.url);
const artifact = await readFile(artifactUrl, 'utf8');
const directory = await mkdtemp(join(tmpdir(), 'binance-chart-storage-smoke-'));
const report = {
  startedAt: new Date().toISOString(),
  environment: 'new anonymous Chrome context, no storageState, existing profile, account, or extensions',
  target,
  artifact: { path: artifactUrl.pathname, sha256: createHash('sha256').update(artifact).digest('hex'), bytes: Buffer.byteLength(artifact) },
  storageReadback: 'not_performed',
  stages: [],
  documentStatuses: [],
  pageErrors: 0,
  pageErrorKinds: { styleParentUnavailable: 0, other: 0 },
  browserClosed: false,
};
let browser;
let page;
let stage = 'launch';

/** Deadlines bound live checks and cleanup; an incomplete operation is never retried. */
async function bounded(operation, timeout = 10000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Smoke operation deadline exceeded')), timeout);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Observe only aggregate destination transactions; never inspect keys, values, or account state. */
function observeDestinationTransactions() {
  if (self !== top || location.href !== 'https://www.binance.com/zh-CN/futures/USUSDT') return;
  const originalTransaction = IDBDatabase.prototype.transaction;
  const originalPut = IDBObjectStore.prototype.put;
  const stats = { transactions: 0, completed: 0, aborted: 0, puts: 0, pending: 0 };
  IDBDatabase.prototype.transaction = function (...args) {
    const transaction = Reflect.apply(originalTransaction, this, args);
    if (this.name === 'chart_delivery' && transaction.mode === 'readwrite') {
      stats.transactions += 1;
      stats.pending += 1;
      transaction.addEventListener('complete', () => { stats.completed += 1; stats.pending -= 1; }, { once: true });
      transaction.addEventListener('abort', () => { stats.aborted += 1; stats.pending -= 1; }, { once: true });
    }
    return transaction;
  };
  IDBObjectStore.prototype.put = function (...args) {
    const request = Reflect.apply(originalPut, this, args);
    if (this.transaction.db.name === 'chart_delivery') stats.puts += 1;
    return request;
  };
  Object.defineProperty(self, '__CHART_STORAGE_SMOKE_OBSERVATION__', {
    value: Object.freeze({ snapshot: () => ({ ...stats }) }),
  });
}

async function assertAnonymousPage() {
  assert.equal(page.url(), target);
  const register = page.getByRole('button', { name: '立即注册', exact: true });
  await register.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await register.count(), 1);
  report.anonymousRegisterVisible = true;
}

function assertOptimized(snapshot) {
  assert.equal(snapshot.status, 'active');
  assert.equal(snapshot.phase, 'active');
  assert.equal(snapshot.matches, 1);
  assert.equal(snapshot.executions, 1);
  assert.equal(snapshot.drawingScope.status, 'active');
  assert.equal(snapshot.drawingScope.executions, 1);
  for (const field of ['rejectedBatches', 'failedBatches', 'abortedTransactions', 'pendingBatches', 'pendingBytes', 'nativePassthroughBatches']) {
    assert.equal(snapshot.writer[field], 0, field);
  }
  assert(snapshot.writer.committedTransactions > 0);
  assert(snapshot.writer.committedWrites > 0);
}

async function snapshot() {
  return page.evaluate(() => {
    const panel = document.getElementById('jh-binance-close-qty-multiplier-panel');
    const style = panel && getComputedStyle(panel);
    return { optimizer: self.__BINANCE_CHART_STORAGE__.snapshot(), destination: self.__CHART_STORAGE_SMOKE_OBSERVATION__.snapshot(),
      startupDOM: self.__CHART_STORAGE_SMOKE_START__,
      orderbook: {
        panelCount: document.querySelectorAll('#jh-binance-close-qty-multiplier-panel').length,
        panelVisible: Boolean(panel && panel.getClientRects().length && style.visibility === 'visible' && style.display !== 'none'),
        modeAnchorPresent: Boolean(document.getElementById('position-direction')),
        styleCount: document.querySelectorAll('#jh-disabled-control-style').length,
        initialized: typeof self.__TM_CLOSE_LONG_DEBUG__ === 'object',
      },
    };
  });
}

async function changeInterval(label, resolution, optimized) {
  await assertAnonymousPage();
  const before = await snapshot();
  const interval = page.getByText(label, { exact: true });
  assert.equal(await interval.count(), 1);
  assert.notEqual(await page.evaluate(() => document.querySelector('#chart_futures-tradingview iframe').contentWindow.tradingViewApi.activeChart().resolution()), resolution);
  await interval.click({ timeout: 10000 });
  await page.waitForFunction(({ committed, destinationCompleted, resolution, optimized }) => {
    const chart = document.querySelector('#chart_futures-tradingview iframe')?.contentWindow?.tradingViewApi?.activeChart();
    if (chart?.resolution() !== resolution || !chart.dataReady()) return false;
    const optimizer = self.__BINANCE_CHART_STORAGE__.snapshot();
    const destination = self.__CHART_STORAGE_SMOKE_OBSERVATION__.snapshot();
    return optimizer.writer.pendingBatches === 0 && destination.pending === 0
      && (optimized ? optimizer.writer.committedTransactions > committed : destination.completed > destinationCompleted);
  }, { committed: before.optimizer.writer.committedTransactions, destinationCompleted: before.destination.completed, resolution, optimized }, { timeout: 25000 });
  await assertAnonymousPage();
  const after = await snapshot();
  const delta = {
    optimizedCommits: after.optimizer.writer.committedTransactions - before.optimizer.writer.committedTransactions,
    destinationCommits: after.destination.completed - before.destination.completed,
    destinationPuts: after.destination.puts - before.destination.puts,
  };
  if (optimized) {
    assertOptimized(after.optimizer);
    assert(delta.optimizedCommits > 0);
  } else {
    assert.equal(after.optimizer.phase, 'stopped');
    assert.equal(after.optimizer.status, 'native');
    assert.deepEqual(after.optimizer.writer, before.optimizer.writer);
    assert(delta.destinationCommits > 0);
    assert(delta.destinationPuts > 0);
  }
  assert.equal(after.destination.aborted, 0);
  report.stages.push({ stage, resolution, chartDataReady: true, before, after, delta });
  console.log(JSON.stringify({ stage, resolution, delta }));
}

console.log(JSON.stringify({ directory, stage, artifact: report.artifact }));
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30000 });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await context.addInitScript(observeDestinationTransactions);
  await context.addInitScript({ content: `self.__CHART_STORAGE_SMOKE_START__ = {
    hasDocumentElement: Boolean(document.documentElement), hasHead: Boolean(document.head)
  };\n${artifact}` });
  page = await context.newPage();
  page.on('pageerror', error => {
    report.pageErrors += 1;
    const styleParentUnavailable = error.name === 'TypeError'
      && error.message.includes('null') && error.message.includes('appendChild')
      && error.stack.includes('injectDisabledControlStyle');
    report.pageErrorKinds[styleParentUnavailable ? 'styleParentUnavailable' : 'other'] += 1;
  });
  page.on('response', response => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame() && request.url() === target) {
      report.documentStatuses.push(response.status());
    }
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && frame.url() !== target) report.navigationRefused = true;
  });
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame() && request.url() !== target) {
      report.navigationRefused = true;
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  stage = 'document';
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  report.documentStatus = response.status();
  await page.getByText('Trading View', { exact: true }).waitFor({ state: 'visible', timeout: 45000 });
  await assertAnonymousPage();
  stage = 'chart_ready';
  await page.getByText('Trading View', { exact: true }).click({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#chart_futures-tradingview iframe')?.contentWindow?.tradingViewApi?.activeChart().dataReady() === true,
    null, { timeout: 45000 });
  const initial = await snapshot();
  assert.equal(initial.optimizer.matches, 1);
  assert.equal(initial.optimizer.executions, 1);
  assert.equal(initial.optimizer.drawingScope.status, 'active');
  assert.equal(initial.optimizer.drawingScope.executions, 1);
  assert.equal(initial.orderbook.panelCount, 1);
  assert.equal(initial.orderbook.styleCount, 1);
  assert.equal(initial.orderbook.initialized, true);
  report.initial = initial;
  stage = 'optimized_one_hour';
  await changeInterval('1小时', '60', true);
  stage = 'optimized_fifteen_minutes';
  await changeInterval('15分钟', '15', true);
  stage = 'stop';
  report.stopped = await bounded(page.evaluate(() => self.__BINANCE_CHART_STORAGE__.stop()));
  assert.equal(report.stopped.phase, 'stopped');
  assert.equal(report.stopped.drawingScope.status, 'active');
  stage = 'native_after_stop';
  await changeInterval('4小时', '240', false);
  assert.equal(report.navigationRefused, undefined);
  assert.equal(report.pageErrors, 0);
  await bounded(page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  await page.screenshot({ path: join(directory, 'page.png'), timeout: 10000 });
  report.outcome = 'production_bulk_and_native_continuation_verified';
} catch (error) {
  report.outcome = 'incomplete';
  report.failure = { stage, name: error.name };
  if (error.message.includes('strict mode violation')) report.failure.reason = 'ambiguous_locator';
  process.exitCode = 1;
} finally {
  try {
    if (page && !page.isClosed()) {
      report.final = await bounded(page.evaluate(async () => {
        const optimizer = self.__BINANCE_CHART_STORAGE__;
        if (!optimizer) return { installed: false };
        await optimizer.stop();
        return { optimizer: optimizer.snapshot(), destination: self.__CHART_STORAGE_SMOKE_OBSERVATION__.snapshot(),
          startupDOM: self.__CHART_STORAGE_SMOKE_START__ };
      }));
      await page.screenshot({ path: join(directory, 'final.png'), timeout: 10000 });
    }
  } catch (error) {
    report.cleanupFailure = { stage: 'page_cleanup', name: error.name };
    report.outcome = 'incomplete';
    process.exitCode = 1;
  }
  try {
    if (browser) {
      await bounded(browser.close(), 15000);
      report.browserClosed = true;
    }
  } catch (error) {
    report.cleanupFailure = { stage: 'browser_close', name: error.name };
    report.outcome = 'incomplete';
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ directory, outcome: report.outcome, failure: report.failure, browserClosed: report.browserClosed }));
}
