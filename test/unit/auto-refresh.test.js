import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../scripts/auto_refresh.user.js', import.meta.url), 'utf8');

test('focus after the scheduled target reloads instead of moving the target to tomorrow', () => {
  let now = new Date(2026, 7, 23, 7, 0, 0).getTime();
  let reloads = 0;
  const windowListeners = new Map();
  const documentListeners = new Map();

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }

    static now() {
      return now;
    }
  }

  const context = {
    Date: FakeDate,
    location: {
      href: 'https://anyrouter.top/console',
      reload() { reloads += 1; },
    },
    window: {
      addEventListener(type, listener) { windowListeners.set(type, listener); },
    },
    document: {
      hidden: false,
      addEventListener(type, listener) { documentListeners.set(type, listener); },
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 2; },
    GM_registerMenuCommand() {},
    alert() {},
    console: { log() {} },
  };

  vm.runInNewContext(source, context);
  now = new Date(2026, 7, 23, 8, 10, 0).getTime();
  windowListeners.get('focus')();

  assert.equal(reloads, 1);
});
