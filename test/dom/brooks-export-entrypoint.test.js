import assert from 'node:assert/strict';
import test from 'node:test';
import { afterDataMediaResponseTurn } from '../helpers/data-media-migration-host.js';
import { createMediaHost } from '../helpers/data-media-migration-media-host.js';
import { buildBrooksMediaIndexExportFilename } from '../../src/m3u8-downloader/brooks-exporter.js';
import { buildBrooksMediaIndexRecord } from '../../src/m3u8-downloader/brooks-record.js';

const stateKey = 'jh-userscripts:brooks-media-index-export';
const indexUrl = 'https://www.brookstradingcourse.com/main-course-videos/';
const links = [
  'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/?ref=course',
  'https://www.brookstradingcourse.com/price-action-fundamentals/video-02-chart-basics/',
  'https://www.brookstradingcourse.com/bonus-videos/trading-patterns-on-the-open/',
];
const courseHtml = '<title>BTC PAF 01 Terminology | Brooks Trading Course</title><iframe src="https://iframe.mediadelivery.net/embed/155631/fixture-video?autoplay=false"></iframe>';

function courseHost(t, selectedLinks = links, options = {}) {
  return createMediaHost(t, {
    url: indexUrl,
    markup: selectedLinks.map((url, index) => `<a href="${url}">Lesson ${index + 1}</a>`).join(''),
    ...options,
  });
}

function stateOf(host) {
  return JSON.parse(host.window.localStorage.getItem(stateKey));
}

function reportFrameMedia(host, videoId) {
  const frame = host.document.querySelector('iframe');
  const pageUrl = new URL(frame.src).searchParams.get('jhBrooksPageUrl');
  host.window.dispatchEvent(new host.window.MessageEvent('message', {
    origin: 'https://iframe.mediadelivery.net', source: frame.contentWindow,
    data: {
      type: 'jh-userscripts:m3u8-detected',
      url: `https://vz-fixture.b-cdn.net/${videoId}/1920x1080/video.m3u8?expires=100&title=Lesson+${videoId}`,
      referer: frame.src,
      brooksExport: { pageUrl, title: `Lesson ${videoId}` },
    },
  }));
}

async function downloadPayload(host) {
  const count = host.downloads.length;
  host.element('brooks-media-export-download').click();
  assert.equal(host.downloads.length, count + 1);
  return JSON.parse(await host.downloads.at(-1).blob.text());
}

test('user receives an explicit error for an invalid media export filename timestamp', () => {
  // Given the public filename contract receives a non-date export timestamp
  const timestamp = 'not-a-timestamp';

  // When the filename is requested for that invalid timestamp
  const createFilename = () => buildBrooksMediaIndexExportFilename(timestamp);

  // Then the error retains the rejected input instead of creating an unusable filename
  assert.throws(createFilename, { message: 'Invalid Brooks media export timestamp: not-a-timestamp' });
});

for (const outcome of ['paused', 'discarded']) {
  test(`user keeps collection ${outcome} when a successful page already queued the next microtask`, { timeout: 5_000 }, async t => {
    // Given one completed page is about to advance a two-course collection
    const host = courseHost(t, links.slice(0, 2));
    await host.start();
    host.element('brooks-media-export-primary').click();
    host.network.requests[0].respond(courseHtml);

    // When the user pauses or discards immediately after media success and before the queued continuation
    reportFrameMedia(host, 'first');
    host.element('brooks-media-export-primary').click();
    if (outcome === 'discarded') host.element('brooks-media-export-reset').click();
    await afterDataMediaResponseTurn();
    host.clock.tick(45_000);

    // Then the pending continuation cannot start the next page or recreate discarded work
    assert.equal(host.network.requests.length, 1);
    assert.equal(host.document.querySelectorAll('iframe').length, 0);
    if (outcome === 'paused') {
      const state = stateOf(host);
      assert.equal(state.index, 1);
      assert.deepEqual(state.records.map(record => record.index), [0]);
      assert.equal(state.running, false);
      assert.equal(state.stopped, true);
      assert.equal(host.element('brooks-media-export-primary').textContent, '继续');
    } else {
      assert.equal(host.window.localStorage.getItem(stateKey), null);
      assert.equal(host.element('brooks-media-export-status').textContent, '发现 2 个课程视频');
      assert.equal(host.element('brooks-media-export-primary').textContent, '开始');
    }
  });
}

test('user rediscovers current courses when saved progress disappears before resume', { timeout: 5_000 }, async t => {
  // Given a two-course export is paused after retaining its first successful page
  const host = courseHost(t, links.slice(0, 2));
  await host.start();
  host.element('brooks-media-export-primary').click();
  host.network.requests[0].respond(courseHtml);
  reportFrameMedia(host, 'first');
  await afterDataMediaResponseTurn();
  host.element('brooks-media-export-primary').click();
  assert.equal(stateOf(host).index, 1);
  assert.equal(host.element('brooks-media-export-primary').textContent, '继续');

  // When saved progress is cleared outside the panel and a new course appears before resume
  host.window.localStorage.removeItem(stateKey);
  const link = host.document.createElement('a');
  link.href = links[2];
  link.textContent = 'New lesson';
  host.document.body.append(link);
  host.element('brooks-media-export-primary').click();

  // Then resume begins a fresh collection from all current links and the first original page
  const state = stateOf(host);
  assert.deepEqual(state.links, links);
  assert.equal(state.index, 0);
  assert.deepEqual(state.records, []);
  assert.deepEqual(state.failures, []);
  assert.deepEqual(host.network.requests.map(request => request.url), [links[0], links[1], links[0]]);
  assert.equal(host.element('brooks-media-export-primary').textContent, '暂停');
});

test('user ignores empty and unrelated page records while preserving the pending course', { timeout: 5_000 }, async t => {
  // Given the exporter accepts same-origin records only for its actively pending page
  const host = courseHost(t, links.slice(0, 2));
  await host.start();
  const record = buildBrooksMediaIndexRecord({ pageUrl: links[1], title: 'Second lesson', m3u8Url: 'https://vz-fixture.b-cdn.net/second/video.m3u8' });
  const send = data => host.window.dispatchEvent(new host.window.MessageEvent('message', { origin: new URL(indexUrl).origin, data }));
  send({ type: 'jh-userscripts:brooks-media-index-record', record });
  assert.equal(host.window.localStorage.getItem(stateKey), null);
  host.element('brooks-media-export-primary').click();
  host.network.requests[0].respond(courseHtml);
  const before = host.window.localStorage.getItem(stateKey);
  const frame = host.document.querySelector('iframe');

  // When empty data and another course's record arrive before the actual pending media
  send(null);
  send({ type: 'jh-userscripts:brooks-media-index-record', record });
  assert.equal(host.window.localStorage.getItem(stateKey), before);
  assert.equal(host.document.querySelector('iframe'), frame);
  reportFrameMedia(host, 'first');
  await afterDataMediaResponseTurn();

  // Then only the matching first course advances the collection to its second original URL
  assert.deepEqual(stateOf(host).records.map(item => ({ index: item.index, url: item.url })), [{ index: 0, url: links[0] }]);
  assert.deepEqual(host.network.requests.map(request => request.url), links.slice(0, 2));
  assert.equal(stateOf(host).index, 1);
});

for (const saved of [
  { name: 'unreadable JSON', value: '{', error: true },
  { name: 'an unsupported schema', value: '{"schemaVersion":1}', error: false },
]) {
  test(`user starts from discovered courses when saved progress contains ${saved.name}`, { timeout: 5_000 }, async t => {
    // Given stored export data cannot be used by the current documented schema
    const host = courseHost(t, links, { storage: { [stateKey]: saved.value } });

    // When the complete userscript initializes its course controls
    await host.start();

    // Then the page remains idle and reports the newly discovered course count
    assert.equal(host.element('brooks-media-export-status').textContent, '发现 3 个课程视频');
    assert.equal(host.element('brooks-media-export-primary').textContent, '开始');
    assert.equal(host.network.requests.length, 0);
    assert.equal(host.logs.some(args => args[0] === 'Unable to load Brooks media export state:'), saved.error);
  });
}

test('user receives an explicit explanation when exporting before a collection exists', { timeout: 5_000 }, async t => {
  // Given the course panel has not started a collection
  const host = courseHost(t);
  await host.start();

  // When export is requested and a hidden retry control is invoked programmatically
  host.element('brooks-media-export-download').click();
  host.element('brooks-media-export-retry-failed').click();

  // Then no request or artifact is created without an eligible export state
  assert.deepEqual(host.alerts, ['没有可导出的 Brooks 视频与字幕清单']);
  assert.equal(host.downloads.length, 0);
  assert.equal(host.network.requests.length, 0);
  assert.equal(host.window.localStorage.getItem(stateKey), null);
});

test('user can inspect an empty collection without mistaking it for a completed course export', { timeout: 5_000 }, async t => {
  // Given the index page currently contains no course video links
  const host = courseHost(t, []);
  await host.start();

  // When the user starts collection and downloads its JSON result
  host.element('brooks-media-export-primary').click();
  const payload = await downloadPayload(host);

  // Then the empty artifact carries zero work and never claims course completion
  assert.equal(host.network.requests.length, 0);
  assert.deepEqual({
    total: payload.total, done: payload.done, completed: payload.completed,
    missingIndexes: payload.missingIndexes, elapsedMs: payload.elapsedMs,
    records: payload.records, failures: payload.failures,
  }, { total: 0, done: 0, completed: false, missingIndexes: [], elapsedMs: 0, records: [], failures: [] });
  assert.equal(host.element('brooks-media-export-reset').style.display, 'none');
  assert.equal(host.blobs.size, 0);
});

for (const failure of [
  { name: 'an HTTP rejection', respond: request => request.respond('Unavailable', 503), error: 'page fetch failed: 503' },
  { name: 'a network error', respond: request => request.fail(), error: 'page fetch network error' },
  { name: 'a page without its media iframe', respond: request => request.respond('<title>Login required</title>'), error: 'Bunny embed iframe not found' },
]) {
  test(`user exports the original failed course identity after ${failure.name}`, { timeout: 5_000 }, async t => {
    // Given one course URL retains its navigation query in the collection
    const host = courseHost(t, [links[0]]);
    await host.start();
    host.element('brooks-media-export-primary').click();

    // When the page request completes through the specified failure boundary
    host.clock.tick(2_000);
    failure.respond(host.network.requests[0]);
    const payload = await downloadPayload(host);

    // Then the visible reason, exported failure, and original index agree
    assert.equal(host.element('brooks-media-export-status').textContent, `已完成 1/1 | 成功 0 | 失败 1\n耗时: 2s\n最近失败: ${failure.error}\n请点“重试失败”；仍失败再导出清单 JSON`);
    assert.deepEqual(payload.failures, [{ ok: false, index: 0, url: links[0], error: failure.error }]);
    assert.deepEqual(stateOf(host).links, [links[0]]);
    assert.equal(payload.completed, true);
    assert.equal(payload.elapsedMs, 2_000);
    assert.equal(payload.nextIndex, 1);
    assert.deepEqual(payload.missingIndexes, []);
    assert.equal(host.element('brooks-media-export-retry-failed').style.display, '');
    assert.equal(host.document.querySelectorAll('iframe').length, 0);
    assert.equal(host.downloads[0].name, 'brooks-media-index-2026-09-16T000002Z.json');
    assert.deepEqual(host.revoked, [host.downloads[0].url]);
  });
}

for (const late of [
  { name: 'successful', respond: request => request.respond(courseHtml) },
  { name: 'failed', respond: request => request.respond('Unavailable', 503) },
]) {
  test(`user times out an unresolved course at 45 seconds and ignores its late ${late.name} page response`, { timeout: 5_000 }, async t => {
    // Given the page request stays pending while the exporter displays waiting time
    const host = courseHost(t, [links[0]]);
    await host.start();
    host.element('brooks-media-export-primary').click();
    const page = host.network.requests[0];

    // When the declared deadline arrives before a late HTTP completion
    host.clock.tick(44_999);
    assert.deepEqual(stateOf(host).failures, []);
    assert.match(host.element('brooks-media-export-status').textContent, /等待 44s/);
    host.clock.tick(1);
    late.respond(page);
    await afterDataMediaResponseTurn();

    // Then only one timeout outcome is kept and stale callbacks create no media frame
    const state = stateOf(host);
    assert.deepEqual(state.failures, [{ ok: false, index: 0, url: links[0], error: 'm3u8 detection timeout' }]);
    assert.equal(state.activeElapsedMs, 45_000);
    assert.equal(state.running, false);
    assert.equal(host.network.requests.length, 1);
    assert.equal(host.document.querySelectorAll('iframe').length, 0);
  });
}

for (const late of [
  { name: 'successful', respond: request => request.respond(courseHtml) },
  { name: 'failed', respond: request => request.fail() },
]) {
  test(`user keeps paused progress unchanged when its former page request completes as ${late.name}`, { timeout: 5_000 }, async t => {
    // Given a course request is still pending after two seconds of active collection
    const host = courseHost(t, [links[0]]);
    await host.start();
    host.element('brooks-media-export-primary').click();
    host.clock.tick(2_000);
    const page = host.network.requests[0];

    // When the user pauses before the old request completes and its old timeout expires
    host.element('brooks-media-export-primary').click();
    late.respond(page);
    host.clock.tick(60_000);
    await afterDataMediaResponseTurn();

    // Then neither the late callback nor paused wall time changes the saved work
    const state = stateOf(host);
    assert.deepEqual({ index: state.index, records: state.records, failures: state.failures, elapsed: state.activeElapsedMs }, {
      index: 0, records: [], failures: [], elapsed: 2_000,
    });
    assert.equal(state.stopped, true);
    assert.equal(host.element('brooks-media-export-primary').textContent, '继续');
    assert.equal(host.document.querySelectorAll('iframe').length, 0);
    assert.equal(host.network.requests.length, 1);
  });
}

test('user downloads partial and complete course JSON with active runtime excluding the pause', { timeout: 5_000 }, async t => {
  // Given two original course links begin a collection at a known timestamp
  const host = courseHost(t, links.slice(0, 2));
  await host.start();
  host.element('brooks-media-export-primary').click();
  host.network.requests[0].respond(courseHtml);
  host.clock.tick(1_250);
  reportFrameMedia(host, 'first');
  await afterDataMediaResponseTurn();
  host.clock.tick(750);

  // When the user exports a paused result, waits a minute, and finishes the remaining page
  host.element('brooks-media-export-primary').click();
  const partial = await downloadPayload(host);
  host.clock.tick(60_000);
  host.element('brooks-media-export-primary').click();
  host.network.requests.at(-1).respond(courseHtml);
  host.clock.tick(3_000);
  reportFrameMedia(host, 'second');
  await afterDataMediaResponseTurn();
  const complete = await downloadPayload(host);

  // Then downloaded content preserves identity and counts only five seconds of active work
  assert.deepEqual({ done: partial.done, completed: partial.completed, missing: partial.missingIndexes, elapsed: partial.elapsedMs, stopped: partial.stopped }, {
    done: 1, completed: false, missing: [1], elapsed: 2_000, stopped: true,
  });
  assert.deepEqual({ done: complete.done, completed: complete.completed, missing: complete.missingIndexes, elapsed: complete.elapsedMs, stopped: complete.stopped }, {
    done: 2, completed: true, missing: [], elapsed: 5_000, stopped: false,
  });
  assert.deepEqual(complete.records.map(record => ({ index: record.index, url: record.url })), links.slice(0, 2).map((url, index) => ({ index, url })));
  assert.equal(complete.records[0].m3u8, 'https://vz-fixture.b-cdn.net/first/1920x1080/video.m3u8?expires=100');
  assert.equal(complete.records[0].cn, 'https://vz-fixture.b-cdn.net/first/captions/CN.vtt?expires=100');
  assert.equal(complete.records[0].en, 'https://vz-fixture.b-cdn.net/first/captions/EN.vtt?expires=100');
  assert.equal(complete.records[0].output, 'Lesson first.%(ext)s');
  assert.equal(complete.elapsedText, '5s');
  assert.equal(complete.startedAt, '2026-09-16T00:00:00.000Z');
  assert.equal(complete.exportedAt, '2026-09-16T00:01:05.000Z');
  assert.equal(host.downloads[1].name, 'brooks-media-index-2026-09-16T000105Z.json');
  assert.equal(host.element('brooks-media-export-reset').style.display, 'none');
  assert.equal(host.blobs.size, 0);
  assert.equal(host.revoked.length, 2);
});

test('user retries two failed original indexes without collecting the successful middle course again', { timeout: 5_000 }, async t => {
  // Given the first and last course fail around one successfully collected middle course
  const host = courseHost(t);
  await host.start();
  host.element('brooks-media-export-primary').click();
  host.network.requests[0].respond('Unavailable', 503);
  host.network.requests[1].respond(courseHtml);
  reportFrameMedia(host, 'middle');
  await afterDataMediaResponseTurn();
  host.network.requests[2].fail();
  assert.deepEqual(stateOf(host).failures.map(failure => failure.index), [0, 2]);

  // When the completed export retries both failures successfully
  host.element('brooks-media-export-retry-failed').click();
  host.network.requests[3].respond(courseHtml);
  reportFrameMedia(host, 'first');
  await afterDataMediaResponseTurn();
  assert.deepEqual(stateOf(host).retryQueue, [2]);
  host.network.requests[4].respond(courseHtml);
  reportFrameMedia(host, 'last');
  await afterDataMediaResponseTurn();
  const payload = await downloadPayload(host);

  // Then the artifact retains all original indexes with no duplicate success or retry queue
  assert.deepEqual(host.network.requests.map(request => request.url), [...links, links[0], links[2]]);
  assert.deepEqual(payload.records.map(record => record.index), [1, 0, 2]);
  assert.deepEqual(payload.failures, []);
  assert.deepEqual(payload.missingIndexes, []);
  assert.equal(payload.nextIndex, 3);
  assert.equal(payload.completed, true);
  assert.equal(Object.hasOwn(stateOf(host), 'retryQueue'), false);
  assert.equal(host.element('brooks-media-export-retry-failed').style.display, 'none');
});

test('user discards paused collection without allowing the abandoned page response to restart it', { timeout: 5_000 }, async t => {
  // Given a page is paused with an outstanding HTML request
  const host = courseHost(t, [links[0]]);
  await host.start();
  host.element('brooks-media-export-primary').click();
  const page = host.network.requests[0];
  host.element('brooks-media-export-primary').click();

  // When reset discards the state before the abandoned page response arrives
  host.element('brooks-media-export-reset').click();
  page.respond(courseHtml);
  host.clock.tick(45_000);
  await afterDataMediaResponseTurn();

  // Then reset remains idle and neither the response nor old deadline recreates progress
  assert.equal(host.window.localStorage.getItem(stateKey), null);
  assert.equal(host.element('brooks-media-export-status').textContent, '发现 1 个课程视频');
  assert.equal(host.element('brooks-media-export-primary').textContent, '开始');
  assert.equal(host.network.requests.length, 1);
  assert.equal(host.document.querySelectorAll('iframe').length, 0);
});
