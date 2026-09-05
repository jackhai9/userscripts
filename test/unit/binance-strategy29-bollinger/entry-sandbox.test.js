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
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTRUSDT' });
  const menus = [];
  const stored = new Map();
  let pagePromptCalls = 0;
  dom.window.prompt = () => { pagePromptCalls += 1; return 'captured-by-page'; };
  const sandbox = {
    unsafeWindow: dom.window,
    prompt(message) { return message.includes('secret') ? 'sandbox-secret' : null; },
    GM_xmlhttpRequest() { throw new Error('remote summary is disabled by default'); },
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
  assert.equal(dom.window[Symbol.for('jh-userscripts.strategy29-bollinger')].version, 2);
  menus.find(menu => menu.label === 'Set Strategy 29 gateway secret').callback();
  assert.equal(stored.get('strategy29GatewayAuthSecret'), 'sandbox-secret');
  assert.equal(pagePromptCalls, 0);
  dom.window.__TM_STRATEGY29_DEBUG__.dispose();
  dom.window.close();
});
