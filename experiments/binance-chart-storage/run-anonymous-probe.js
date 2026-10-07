import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const target = 'https://www.binance.com/zh-CN/futures/USUSDT';
const directory = await mkdtemp(join(tmpdir(), 'binance-mirror-bulk-probe-'));
const report = { startedAt: new Date().toISOString(), environment: 'new anonymous Chrome context, no storageState or extensions', stages: [], browserClosed: false, pageErrors: 0 };
const bundle = await build({ entryPoints: [new URL('anonymous-probe-entry.js', import.meta.url).pathname], bundle: true,
  write: false, format: 'iife', target: 'es2022', minify: false });
await writeFile(join(directory, 'injection.js'), bundle.outputFiles[0].text);
let browser;
let page;
let stage = 'launch';

/** Cleanup has a deadline because accepted IndexedDB work can remain blocked. */
async function bounded(operation) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Probe operation deadline exceeded')), 10000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function validateStats(snapshot) {
  assert.equal(snapshot.capture, 'captured');
  assert.equal(snapshot.matched, 1);
  assert.equal(snapshot.executed, 1);
  assert.equal(snapshot.failed, 0);
  for (const field of ['rejectedBatches', 'failedBatches', 'abortedTransactions', 'pendingBatches', 'pendingBytes']) {
    assert.equal(snapshot.writer[field], 0, field);
  }
  assert(snapshot.writer.committedTransactions > 0);
  assert(snapshot.writer.committedWrites > 0);
}

/** Check only the fixed anonymous page contract; never collect account or storage contents. */
async function assertAnonymousPage() {
  assert.equal(page.url(), target);
  report.anonymousControls = await page.getByText('立即注册', { exact: true }).evaluateAll(nodes => nodes.map(node => ({
    tag: node.tagName, parentTag: node.parentElement.tagName, visible: node.getClientRects().length > 0,
  })));
  const register = page.getByRole('button', { name: '立即注册', exact: true });
  await register.waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await register.count(), 1);
}

async function changeInterval(label, resolution) {
  await assertAnonymousPage();
  const before = await page.evaluate(() => self.__ANONYMOUS_MIRROR_PROBE__.snapshot());
  await page.getByText(label, { exact: true }).click({ timeout: 10000 });
  await page.waitForFunction(({ completed, resolution }) => {
    const chart = document.querySelector('#chart_futures-tradingview iframe')?.contentWindow?.tradingViewApi?.activeChart();
    return self.__ANONYMOUS_MIRROR_PROBE__.snapshot().completed > completed && chart?.resolution() === resolution && chart.dataReady();
  }, { completed: before.completed, resolution }, { timeout: 25000 });
  await assertAnonymousPage();
  const after = await page.evaluate(() => self.__ANONYMOUS_MIRROR_PROBE__.snapshot());
  const verification = await page.evaluate(() => self.__ANONYMOUS_MIRROR_PROBE__.verifyLast());
  assert(verification.entries > 0);
  assert.equal(verification.valuesMatch, true);
  report.stages.push({ stage, resolution, before, after, verification });
  console.log(JSON.stringify({ stage, completed: after.completed, writer: after.writer, verification }));
  return after;
}

console.log(JSON.stringify({ directory, stage }));
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await context.addInitScript({ content: bundle.outputFiles[0].text });
  page = await context.newPage();
  page.on('pageerror', () => { report.pageErrors += 1; });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && frame.url() !== target) report.navigationRefused = true;
  });
  // The runner never connects to an existing browser or imports a profile.
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
  stage = 'bulk_one_hour';
  validateStats(await changeInterval('1小时', '60'));
  stage = 'bulk_fifteen_minutes';
  validateStats(await changeInterval('15分钟', '15'));
  await bounded(page.evaluate(() => self.__ANONYMOUS_MIRROR_PROBE__.stop()));
  const stopped = await page.evaluate(() => self.__ANONYMOUS_MIRROR_PROBE__.snapshot());
  stage = 'native_after_stop';
  const native = await changeInterval('4小时', '240');
  assert(native.nativeCalls > stopped.nativeCalls);
  assert.deepEqual(native.writer, stopped.writer);
  assert.equal(native.failed, 0);
  assert.equal(report.navigationRefused, undefined);
  assert.equal(report.pageErrors, 0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: join(directory, 'page.png') });
  report.outcome = 'bulk_and_native_continuation_verified';
} catch (error) {
  report.outcome = 'incomplete';
  report.failure = { stage, name: error.name };
  if (error.message.includes('strict mode violation')) report.failure.reason = 'ambiguous_locator';
  process.exitCode = 1;
} finally {
  try {
    if (page && !page.isClosed()) {
      report.final = await bounded(page.evaluate(async () => {
        const probe = self.__ANONYMOUS_MIRROR_PROBE__;
        if (!probe) return { installed: false };
        await probe.stop();
        return probe.snapshot();
      }));
      await page.screenshot({ path: join(directory, 'final.png') });
    }
  } finally {
    if (browser) { await browser.close(); report.browserClosed = true; }
    report.finishedAt = new Date().toISOString();
    await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ directory, outcome: report.outcome, failure: report.failure, browserClosed: report.browserClosed }));
  }
}
