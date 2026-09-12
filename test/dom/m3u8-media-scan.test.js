import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../scripts/m3u8-downloader.user.js', import.meta.url), 'utf8');

async function harness(t, markup = '') {
  const dom = new JSDOM(markup, { url: 'https://njav.com/watch/fixture', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  const frames = [];
  const requests = [];
  const scannedVideos = [];
  let documentScans = 0;
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  window.XMLHttpRequest = class {
    open(method, url) { assert.equal(method, 'GET'); requests.push(url); }
    send() {}
  };
  const query = window.document.querySelectorAll.bind(window.document);
  window.document.querySelectorAll = selector => {
    if (selector === 'video') documentScans += 1;
    return query(selector);
  };
  const elementQuery = window.Element.prototype.querySelectorAll;
  window.Element.prototype.querySelectorAll = function (selector) {
    if (this.tagName === 'VIDEO' && selector === 'source') scannedVideos.push(this);
    return elementQuery.call(this, selector);
  };
  async function flush() {
    await Promise.resolve();
    for (const callback of frames.splice(0)) callback();
    await Promise.resolve();
  }
  window.eval(source);
  await new Promise(setImmediate);
  await flush();
  scannedVideos.length = 0;
  documentScans = 0;
  return { window, document: window.document, frames, requests, scannedVideos, flush, get documentScans() { return documentScans; } };
}

test('a source change scans only its owning video among 100 existing videos', async t => {
  const h = await harness(t, Array.from({ length: 100 }, (_, index) => `<video><source src="https://media.example/${index}.webm"></video>`).join(''));
  const video = h.document.querySelector('video');
  video.firstChild.src = 'https://media.example/new.m3u8';
  await h.flush();
  assert.deepEqual(h.requests, ['https://media.example/new.m3u8']);
  assert.deepEqual(h.scannedVideos, [video]);
  assert.equal(h.documentScans, 0);
});

test('separate mutations deduplicate videos and preserve all sources discovered in the frame', async t => {
  const h = await harness(t, '<video id="a"></video><video id="b"></video>');
  const a = h.document.querySelector('#a');
  const b = h.document.querySelector('#b');
  a.src = 'https://media.example/a.m3u8';
  await Promise.resolve();
  const sourceNode = Object.assign(h.document.createElement('source'), { src: 'https://media.example/alt.m3u8' });
  a.appendChild(sourceNode);
  b.src = 'https://media.example/b.m3u8';
  await Promise.resolve();
  assert.equal(h.frames.length, 1);
  await h.flush();
  assert.deepEqual(h.scannedVideos, [a, b]);
  assert.deepEqual(h.requests.sort(), ['https://media.example/a.m3u8', 'https://media.example/alt.m3u8', 'https://media.example/b.m3u8']);
});

test('added media subtrees are scanned without revisiting unrelated existing videos', async t => {
  const h = await harness(t, '<video id="old"></video>');
  const wrapper = h.document.createElement('div');
  wrapper.innerHTML = '<section><video id="new"><source src="https://media.example/added.m3u8"></video></section>';
  h.document.body.appendChild(wrapper);
  await h.flush();
  assert.deepEqual(h.scannedVideos.map(video => video.id), ['new']);
  assert.deepEqual(h.requests, ['https://media.example/added.m3u8']);
  assert.equal(h.documentScans, 0);
});

test('a video removed before the frame is not scanned or requested', async t => {
  const h = await harness(t, '<video></video>');
  const video = h.document.querySelector('video');
  video.src = 'https://media.example/removed.m3u8';
  await Promise.resolve();
  video.remove();
  await h.flush();
  assert.deepEqual(h.scannedVideos, []);
  assert.deepEqual(h.requests, []);
});

test('a queued video adopted into another document is no longer owned by this scanner', async t => {
  const h = await harness(t, '<video></video>');
  const video = h.document.querySelector('video');
  video.src = 'https://media.example/moved.m3u8';
  await Promise.resolve();
  const otherDocument = h.document.implementation.createHTMLDocument('Other media document');
  otherDocument.body.appendChild(video);
  assert.equal(video.isConnected, true);
  await h.flush();
  assert.deepEqual(h.requests, []);
});

test('sources inside a newly inserted wrapper still queue their existing owning video', async t => {
  const h = await harness(t, '<video id="owner"></video><video id="unrelated"></video>');
  const wrapper = h.document.createElement('div');
  wrapper.innerHTML = '<source src="https://media.example/nested.m3u8">';
  h.document.querySelector('#owner').appendChild(wrapper);
  await h.flush();
  assert.deepEqual(h.scannedVideos.map(video => video.id), ['owner']);
  assert.deepEqual(h.requests, ['https://media.example/nested.m3u8']);
});

test('non-media src mutations and text updates queue no media work', async t => {
  const h = await harness(t, '<video></video><img><p>Old</p><picture><source></picture>');
  h.document.querySelector('img').src = 'https://media.example/image.jpg';
  h.document.querySelector('picture source').src = 'https://media.example/preview.webp';
  h.document.querySelector('p').textContent = 'New';
  await Promise.resolve();
  assert.equal(h.frames.length, 0);
  assert.deepEqual(h.scannedVideos, []);
});

test('initial media discovery and later load discovery keep request deduplication', async t => {
  const h = await harness(t, '<video src="https://media.example/initial.m3u8"></video>');
  assert.deepEqual(h.requests, ['https://media.example/initial.m3u8']);
  h.document.querySelector('video').setAttribute('src', 'https://media.example/initial.m3u8');
  await h.flush();
  assert.deepEqual(h.requests, ['https://media.example/initial.m3u8']);
  assert.equal(h.scannedVideos.length, 1);
});
