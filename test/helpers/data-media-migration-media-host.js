import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { afterDataMediaResponseTurn, installDataMediaClock } from './data-media-migration-host.js';

/** Model browser HTTP completion without opening a network connection. */
export function createMediaRequestBoundary() {
  const requests = [];
  class MediaXHR {
    static UNSENT = 0;
    static OPENED = 1;
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;
    readyState = 0;
    settled = false;
    open(...args) {
      this.args = args;
      this.url = String(args[1]);
      this.readyState = 1;
    }
    send(body) {
      this.body = body;
      requests.push(this);
    }
    receiveHeaders(status) {
      assert.equal(this.readyState, 1, 'headers follow an opened request');
      this.status = status;
      this.readyState = 2;
      if (this.onreadystatechange) this.onreadystatechange();
    }
    receiveChunk(response) {
      assert.ok(this.readyState === 2 || this.readyState === 3, 'body chunks follow response headers');
      this.response = response;
      this.responseText = response;
      this.readyState = 3;
      if (this.onreadystatechange) this.onreadystatechange();
    }
    respond(response, status = 200) {
      assert.equal(this.settled, false, 'an XHR completion is delivered only once');
      this.settled = true;
      this.status = status;
      this.response = response;
      this.responseText = response;
      this.readyState = 4;
      if (this.onreadystatechange) this.onreadystatechange();
      if (this.onload) this.onload();
    }
    fail() {
      assert.equal(this.settled, false);
      this.settled = true;
      this.onerror();
    }
  }
  return { requests, MediaXHR };
}

export function createMediaHost(t, {
  url = 'https://njav.com/watch/fixture', markup = '<title>Fixture lesson</title>',
  clipboard = 'native', storage = {}, now = Date.UTC(2026, 8, 16), parentUrl = null,
} = {}) {
  const dom = new JSDOM(parentUrl ? '<body></body>' : markup, {
    url: parentUrl || url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  let window = dom.window;
  const parentMessages = [];
  if (parentUrl) {
    const frame = dom.window.document.createElement('iframe');
    frame.src = url;
    dom.window.document.body.append(frame);
    window = frame.contentWindow;
    window.document.open();
    window.document.write(markup);
    window.document.close();
    dom.window.addEventListener('message', event => parentMessages.push(event.data));
  }
  const clock = installDataMediaClock(t, window, now);
  const network = createMediaRequestBoundary();
  const downloads = [], copied = [], fallbackCopies = [], alerts = [], opened = [], logs = [];
  const blobs = new Map();
  const revoked = [];
  let nextBlob = 1;
  window.XMLHttpRequest = network.MediaXHR;
  window.Blob = Blob;
  window.URL.createObjectURL = blob => {
    const url = `blob:https://fixture.test/${nextBlob++}`;
    blobs.set(url, blob);
    return url;
  };
  window.URL.revokeObjectURL = url => { revoked.push(url); blobs.delete(url); };
  window.alert = text => alerts.push(text);
  window.open = url => opened.push(url);
  window.console.log = (...args) => logs.push(args);
  window.console.error = (...args) => logs.push(args);
  if (clipboard !== 'absent') {
    Object.defineProperty(window.navigator, 'clipboard', { value: {
      writeText(text) {
        if (clipboard === 'rejected') return Promise.reject(new Error('fixture clipboard permission denied'));
        copied.push(text);
        return Promise.resolve();
      },
    } });
  }
  window.document.execCommand = command => {
    assert.equal(command, 'copy');
    fallbackCopies.push(window.document.querySelector('textarea').value);
    return true;
  };
  window.document.addEventListener('click', event => {
    const anchor = event.target.closest('a[download]');
    if (!anchor) return;
    event.preventDefault();
    downloads.push({ name: anchor.download, url: anchor.href, blob: blobs.get(anchor.href) });
  }, true);
  window.Element.prototype.getBoundingClientRect = function () {
    const visible = this.matches('[data-visible="true"]');
    return { left: 0, top: 0, right: visible ? 640 : 0, bottom: visible ? 360 : 0, width: visible ? 640 : 0, height: visible ? 360 : 0 };
  };
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  t.after(() => dom.window.close());
  const artifact = new URL('../../scripts/m3u8-downloader.user.js', import.meta.url);
  return {
    window, document: window.document, clock, network, downloads, copied, fallbackCopies,
    alerts, opened, logs, blobs, revoked, parentMessages,
    element: id => window.document.getElementById(id),
    async start({ waitForDocumentReady = true } = {}) {
      if (waitForDocumentReady && window.document.readyState === 'loading') {
        await new Promise(resolve => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }
      const source = readFileSync(artifact, 'utf8');
      if (parentUrl) window.eval(source);
      else new vm.Script(source, { filename: fileURLToPath(artifact) }).runInContext(dom.getInternalVMContext());
      clock.tick(0);
      await afterDataMediaResponseTurn();
    },
    async renderFrame() {
      await afterDataMediaResponseTurn();
      clock.tick(16);
      await afterDataMediaResponseTurn();
    },
  };
}
