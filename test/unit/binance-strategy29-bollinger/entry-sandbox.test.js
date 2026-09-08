import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const ENTRY = 'src/binance-strategy29-bollinger/index.user.js';

async function bundledEntry() {
  const result = await build({ entryPoints: [ENTRY], bundle: true, write: false, format: 'iife' });
  return result.outputFiles[0].text;
}

test('sandbox entry installs the runtime on unsafeWindow and keeps the shared page singleton visible', async () => {
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTRUSDT', pretendToBeVisual: true });
  const menus = [];
  const stored = new Map();
  let pagePromptCalls = 0;
  dom.window.prompt = () => { pagePromptCalls += 1; return 'captured-by-page'; };
  const sandbox = {
    unsafeWindow: dom.window,
    prompt(message) { return message.includes('secret') ? 'sandbox-secret' : null; },
    GM_xmlhttpRequest() { throw new Error('Strategy29 must use the shared transport'); },
    GM_getValue(key, fallback) { return stored.has(key) ? stored.get(key) : fallback; },
    GM_setValue(key, value) { stored.set(key, value); },
    GM_registerMenuCommand(label, callback) { menus.push({ label, callback }); },
    URL,
    AbortController,
    DOMException,
    console,
  };
  vm.runInNewContext(await bundledEntry(), sandbox);
  assert.equal(typeof dom.window.__TM_STRATEGY29_DEBUG__.dispose, 'function');
  assert.equal(sandbox.__TM_STRATEGY29_DEBUG__, undefined);
  assert.equal(dom.window[Symbol.for('jh-userscripts.strategy29-bollinger')].version, 4);
  assert.deepEqual(menus, []);
  assert.equal(stored.size, 0);
  assert.equal(dom.window[Symbol.for('jh-userscripts.strategy29-preferences-migration')], undefined);
  assert.equal(dom.window.__TM_STRATEGY29_DEBUG__.diagnostics.remoteSummary.state, 'waiting_for_gateway');
  assert.equal(pagePromptCalls, 0);
  assert.match(dom.window.document.getElementById('jh-strategy29-client-upgrade').textContent, /Update or install the Strategy 27 signal client/);
  assert.equal(dom.window.document.getElementById('jh-strategy29-summary-panel'), null);
  dom.window.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');
  assert.match(dom.window.document.getElementById('jh-strategy29-client-upgrade').textContent, /更新或安装 Strategy 27 信号客户端/);
  assert.equal(dom.window.__TM_STRATEGY29_DEBUG__.diagnostics.timerRunning, true);
  dom.window.__TM_STRATEGY29_DEBUG__.dispose();
  assert.equal(dom.window.document.getElementById('jh-strategy29-client-upgrade'), null);
  dom.window.close();
});
