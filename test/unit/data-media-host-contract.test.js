import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { afterDataMediaResponseTurn, createDataMediaNetwork, createDataPanelHost, installDataMediaClock, observeDom } from '../helpers/data-media-migration-host.js';
import { createMediaHost } from '../helpers/data-media-migration-media-host.js';

test('user controls browser deadlines and calendar time through the same clock', t => {
  // Given a page with one cancellable timeout and one recurring callback
  const dom = new JSDOM('<body></body>');
  t.after(() => dom.window.close());
  const clock = installDataMediaClock(t, dom.window, 1_000);
  const calls = [];
  const interval = dom.window.setInterval(() => calls.push(dom.window.Date.now()), 500);
  const timeout = dom.window.setTimeout(() => calls.push('cancelled'), 750);

  // When the timeout is cancelled and the interval reaches two deadlines
  dom.window.clearTimeout(timeout);
  clock.tick(499);
  assert.deepEqual(calls, []);
  clock.tick(1);
  clock.tick(500);
  dom.window.clearInterval(interval);
  clock.tick(500);

  // Then only the two due interval callbacks execute with matching timestamps
  assert.deepEqual(calls, [1_500, 2_000]);
  assert.equal(dom.window.Date.now(), 2_500);
});

test('user receives exactly the response supplied for each pending data request', async () => {
  // Given two independent requests awaiting modeled upstream responses
  const network = createDataMediaNetwork();
  const first = network.fetch('https://example.test/first');
  const second = network.fetch('https://example.test/second');
  const observed = network.waitForRequest(request => request.url.pathname === '/second');

  // When the second request succeeds and the first returns a client error
  (await observed).respond({ source: 'second' });
  network.requests[0].respond({ error: 'invalid input' }, 400);
  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  // Then response identity and HTTP status remain bound to the original request
  assert.equal(firstResponse.ok, false);
  assert.equal(firstResponse.status, 400);
  assert.deepEqual(await firstResponse.json(), { error: 'invalid input' });
  assert.equal(secondResponse.ok, true);
  assert.deepEqual(await secondResponse.json(), { source: 'second' });
  assert.throws(() => network.requests[1].respond({ duplicate: true }), /one terminal outcome/);
});

test('user receives distinct GM response, network failure, and timeout callbacks', async () => {
  // Given a GM boundary whose callbacks record their terminal outcomes
  const network = createDataMediaNetwork();
  const outcomes = [];
  const options = {
    url: 'https://example.test/cmc',
    onload: response => outcomes.push(response),
    onerror: () => outcomes.push('network'),
    ontimeout: () => outcomes.push('timeout'),
  };
  const requested = network.waitForRequest(request => request.url.pathname === '/cmc');

  // When successive requests receive their declared boundary result
  network.gmRequest(options);
  (await requested).respond({ data: [1] }, 503);
  network.gmRequest(options);
  network.requests[1].fail('error');
  network.gmRequest(options);
  network.requests[2].fail('timeout');

  // Then each callback is delivered once with the supplied status and body
  assert.deepEqual(outcomes, [{ status: 503, responseText: '{"data":[1]}' }, 'network', 'timeout']);
  assert.equal(network.requests.every(request => request.settled), true);
});

test('user waits for matching DOM content without waiting for elapsed wall time', async t => {
  // Given a document whose completion text is not yet present
  const dom = new JSDOM('<body><div id="status">Loading</div></body>');
  t.after(() => dom.window.close());
  const status = dom.window.document.getElementById('status');
  const completion = observeDom(dom.window, () => status.textContent === 'Complete');

  // When the document publishes its actual completion state
  status.textContent = 'Complete';
  await completion;
  await observeDom(dom.window, () => status.textContent === 'Complete');

  // Then both pending and already-complete observations report the same state
  assert.equal(status.textContent, 'Complete');
});

test('user observes settled response reactions before the next host completion task', async () => {
  // Given one completed response and one request that the host still holds open
  const network = createDataMediaNetwork();
  const first = network.fetch('https://example.test/first');
  network.fetch('https://example.test/pending');
  const effects = [];
  first.then(response => response.json()).then(body => Promise.resolve(body.value)).then(value => effects.push(value));

  // When the response is delivered and the host posts its completion task
  network.requests[0].respond({ value: 'rendered' });
  await afterDataMediaResponseTurn();

  // Then all completed-response reactions ran while unrelated work stayed pending
  assert.deepEqual(effects, ['rendered']);
  assert.equal(network.requests[1].settled, false);
});

test('user can install the trading entrypoint during loading without starting its requests early', { timeout: 5_000 }, async t => {
  // Given the host exposes the document's actual loading state and readiness event
  const host = createDataPanelHost(t, 'trading');
  assert.equal(host.document.readyState, 'loading');
  const ready = new Promise(resolve => host.document.addEventListener('DOMContentLoaded', resolve, { once: true }));

  // When installation precedes the browser's readiness event
  const started = host.start({ waitForDocumentReady: false });
  assert.equal(host.network.requests.length, 0);
  await ready;
  await started;

  // Then the real entrypoint starts exactly its initial server-time request after readiness
  assert.notEqual(host.document.readyState, 'loading');
  assert.deepEqual(host.network.requests.map(request => request.url.pathname), ['/fapi/v1/time']);
  assert.equal(host.network.requests[0].settled, false);
});

test('user can observe a real nested media window delivering data to its own parent', { timeout: 5_000 }, async t => {
  // Given the media host owns an actual child browsing context with its own URL and document
  const parentUrl = 'https://www.brookstradingcourse.com/main-course-videos/';
  const url = 'https://iframe.mediadelivery.net/embed/155631/fixture-video';
  const host = createMediaHost(t, { parentUrl, url, markup: '<title>Nested fixture</title><video src="https://cdn.example/lesson.m3u8"></video>' });
  const received = new Promise(resolve => host.window.parent.addEventListener('message', event => resolve(event.data), { once: true }));
  const data = { type: 'fixture-media-boundary', value: 17 };

  // When the child sends a browser message to the declared parent origin
  host.window.parent.postMessage(data, new URL(parentUrl).origin);
  host.clock.tick(0);
  const delivered = await received;

  // Then parent identity, child content, and the delivered payload remain separate and inspectable
  assert.notEqual(host.window.top, host.window.self);
  assert.equal(host.window.parent.location.href, parentUrl);
  assert.equal(host.window.location.href, url);
  assert.equal(host.document.referrer, parentUrl);
  assert.equal(host.document.querySelector('video').src, 'https://cdn.example/lesson.m3u8');
  assert.deepEqual(delivered, data);
  assert.deepEqual(host.parentMessages, [data]);
});

test('user can install the media entrypoint while loading and receive course controls after readiness', { timeout: 5_000 }, async t => {
  // Given the course index starts loading with one lesson and an unwrapped XHR constructor
  const host = createMediaHost(t, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    markup: '<a href="/price-action-fundamentals/video-01-terminology/">First lesson</a>',
  });
  assert.equal(host.document.readyState, 'loading');
  const original = host.window.XMLHttpRequest;
  const ready = new Promise(resolve => host.document.addEventListener('DOMContentLoaded', resolve, { once: true }));

  // When the full entrypoint installs before readiness and its scheduled controls become due
  const started = host.start({ waitForDocumentReady: false });
  assert.notEqual(host.window.XMLHttpRequest, original);
  assert.equal(host.element('brooks-media-export-dom'), null);
  await ready;
  host.clock.tick(0);
  await started;

  // Then readiness mounts the actual course panel without starting collection
  assert.equal(host.element('brooks-media-export-status').textContent, '发现 1 个课程视频');
  assert.equal(host.element('brooks-media-export-primary').textContent, '开始');
  assert.equal(host.network.requests.length, 0);
});
