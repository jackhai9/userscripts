import assert from 'node:assert/strict';
import test from 'node:test';
import { afterDataMediaResponseTurn } from '../helpers/data-media-migration-host.js';
import { createMediaHost, createMediaRequestBoundary } from '../helpers/data-media-migration-media-host.js';

const mediaUrl = 'https://cdn.example/lesson/playlist.m3u8?token=fixture&expires=100';
const playlist = '#EXTM3U\n#EXTINF:10,\nsegment.ts\n';

async function detectedMedia(t, options = {}) {
  const host = createMediaHost(t, { markup: `<title>Fixture lesson</title><video src="${mediaUrl}"></video>`, ...options });
  await host.start();
  assert.equal(host.network.requests.length, 1);
  host.network.requests[0].respond(playlist);
  return host;
}

test('user receives XHR ready-state and load events with the declared response body', () => {
  // Given a request boundary records the original open arguments and callback events
  const { MediaXHR, requests } = createMediaRequestBoundary();
  const request = new MediaXHR();
  const events = [];
  request.onreadystatechange = () => events.push(['ready', request.readyState]);
  request.onload = () => events.push(['load', request.status, request.responseText]);

  // When the modeled network completes the pending request
  request.open('GET', mediaUrl, true);
  request.send(null);
  request.receiveHeaders(206);
  request.receiveChunk('#EXTM3U\n');
  request.respond(playlist, 206);

  // Then the same request owns its arguments, body, response, and ordered completion events
  assert.equal(requests[0], request);
  assert.deepEqual(request.args, ['GET', mediaUrl, true]);
  assert.equal(request.body, null);
  assert.deepEqual(events, [['ready', 2], ['ready', 3], ['ready', 4], ['load', 206, playlist]]);
  assert.throws(() => request.respond('duplicate'), /delivered only once/);
});

test('user receives playlist controls only after the HTTP response body completes', { timeout: 5_000 }, async t => {
  // Given the page has discovered a playlist whose response is still streaming
  const host = createMediaHost(t, { markup: `<title>Fixture lesson</title><video src="${mediaUrl}"></video>` });
  await host.start();
  const request = host.network.requests[0];

  // When response headers and a recognizable partial body arrive before final completion
  request.receiveHeaders(200);
  request.receiveChunk(playlist);
  assert.equal(host.element('m3u8-download-dom'), null);
  request.respond(playlist);
  host.element('m3u8-copy-command').click();

  // Then one completed playlist produces usable controls and the original media command
  assert.equal(host.document.querySelectorAll('#m3u8-download-dom').length, 1);
  assert.equal(host.copied[0], `yt-dlp --referer 'https://njav.com/watch/fixture' -N 16 -o 'Fixture lesson.%(ext)s' '${mediaUrl}'`);
  assert.equal(host.network.requests.length, 1);
});

test('user keeps successful captions and receives the declared error when another caption returns HTTP 503', { timeout: 5_000 }, async t => {
  // Given the installed downloader has recognized the page's complete playlist
  const host = await detectedMedia(t);
  const caption = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFixture\n';

  // When the user starts injection and only the Chinese caption endpoint fails
  host.element('m3u8-append').click();
  host.network.requests.find(request => request.url.includes('/captions/CN.vtt')).respond('Unavailable', 503);
  host.network.requests.find(request => request.url.includes('/captions/EN.vtt')).respond(caption);
  await afterDataMediaResponseTurn();

  // Then the request boundary reports its exact failure while the successful caption remains downloadable
  const failures = host.logs.filter(args => args[0] === 'Error downloading caption:');
  assert.equal(failures.length, 1);
  assert.equal(failures[0][1].name, 'Error');
  assert.equal(failures[0][1].message, 'Failed to download caption: 503');
  assert.deepEqual(host.downloads.map(download => download.name), ['Fixture lesson.en.vtt']);
  assert.equal(await host.downloads[0].blob.text(), caption);
  assert.equal(host.blobs.size, 0);
});

for (const scenario of [
  { name: 'an ordinary player', pageUrl: null, title: null },
  { name: 'a course player with its title', pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/', title: 'Video 01 Terminology' },
  { name: 'a course player without an export title', pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/', title: null },
]) {
  test(`user receives the detected playlist from ${scenario.name} through its actual parent window`, { timeout: 5_000 }, async t => {
    // Given the installed entrypoint runs in a real nested player document
    const parentUrl = 'https://www.brookstradingcourse.com/main-course-videos/';
    const frameUrl = new URL('https://iframe.mediadelivery.net/embed/155631/fixture-video');
    if (scenario.pageUrl) frameUrl.searchParams.set('jhBrooksPageUrl', scenario.pageUrl);
    if (scenario.title) frameUrl.searchParams.set('jhBrooksTitle', scenario.title);
    const host = createMediaHost(t, { parentUrl, url: frameUrl.href, markup: `<title>Nested player</title><video src="${mediaUrl}"></video>` });
    await host.start();
    const received = new Promise(resolve => host.window.parent.addEventListener('message', event => resolve(event.data), { once: true }));

    // When the nested player's complete playlist response reaches its page-context code
    host.network.requests[0].respond(playlist);
    host.clock.tick(0);
    const message = await received;

    // Then the parent receives the original referer and optional course identity with no child controls
    assert.equal(message.type, 'jh-userscripts:m3u8-detected');
    assert.equal(message.url, `${mediaUrl}&title=Nested+player`);
    assert.equal(message.referer, frameUrl.href);
    if (scenario.pageUrl) {
      assert.equal(message.brooksExport.pageUrl, scenario.pageUrl);
      assert.equal(message.brooksExport.title, scenario.title || '');
    } else assert.equal(message.brooksExport, undefined);
    assert.equal(host.parentMessages.length, 1);
    assert.equal(host.element('m3u8-download-dom'), null);
    assert.equal(host.downloads.length, 0);
  });
}

test('user receives a Brooks media index record from the detected course video page', { timeout: 5_000 }, async t => {
  // Given the full entrypoint runs on a course video page with a detected CDN playlist
  const pageUrl = 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/?ref=course';
  const source = 'https://vz-fixture.b-cdn.net/first/1920x1080/video.m3u8?expires=100';
  const host = createMediaHost(t, { url: pageUrl, markup: `<title>Video 01 Terminology</title><video src="${source}"></video>` });
  await host.start();
  const received = new Promise(resolve => host.window.addEventListener('message', event => resolve(event.data), { once: true }));

  // When the page recognizes its successful playlist and delivers the index notification
  host.network.requests[0].respond(playlist);
  host.clock.tick(0);
  const message = await received;

  // Then the emitted record preserves page identity and derives media and caption URLs from its actual host
  assert.equal(message.type, 'jh-userscripts:brooks-media-index-record');
  assert.equal(message.record.pageUrl, pageUrl);
  assert.equal(message.record.referer, pageUrl);
  assert.equal(message.record.title, 'Video 01 Terminology');
  assert.equal(message.record.output, 'Video 01 Terminology.%(ext)s');
  assert.equal(message.record.m3u8, source);
  assert.equal(message.record.cn, 'https://vz-fixture.b-cdn.net/first/captions/CN.vtt?expires=100');
  assert.equal(message.record.en, 'https://vz-fixture.b-cdn.net/first/captions/EN.vtt?expires=100');
  assert.equal(host.element('m3u8-copy-command').style.display, 'block');
});

test('user sees download controls only for a successful recognized media playlist', { timeout: 5_000 }, async t => {
  // Given three media elements point to a missing file, text page, and valid playlist
  const host = createMediaHost(t, { markup: '<title>Fixture lesson</title><video src="/missing.m3u8"></video><video src="/text.m3u8"></video><video src="/valid.m3u8"></video>' });
  await host.start();

  // When the first two requests fail recognition and the third returns HLS content
  host.network.requests[0].respond('Not found', 404);
  host.network.requests[1].respond('<html>Not media</html>');
  assert.equal(host.element('m3u8-download-dom'), null);
  host.network.requests[2].respond(playlist);

  // Then exactly one control panel appears with a usable external download action
  assert.equal(host.document.querySelectorAll('#m3u8-download-dom').length, 1);
  assert.equal(host.element('m3u8-jump').style.display, 'block');
  assert.equal(host.element('m3u8-download-dom').style.position, 'fixed');
});

for (const clipboard of ['native', 'rejected', 'absent']) {
  test(`user copies a complete yt-dlp command with the ${clipboard} clipboard boundary`, { timeout: 5_000 }, async t => {
    // Given a valid playlist retains its non-title query parameters
    const host = await detectedMedia(t, { clipboard });

    // When the user presses the actual copy-command button
    host.element('m3u8-copy-command').click();
    await afterDataMediaResponseTurn();

    // Then the command preserves the media URL and referer and removes transient textareas
    const copies = clipboard === 'native' ? host.copied : host.fallbackCopies;
    assert.deepEqual(copies, [`yt-dlp --referer 'https://njav.com/watch/fixture' -N 16 -o 'Fixture lesson.%(ext)s' '${mediaUrl}'`]);
    assert.equal(host.document.querySelector('textarea'), null);
    assert.deepEqual(host.alerts, ['yt-dlp 命令已复制']);
  });
}

test('user opens the external downloader with the complete detected source and can close its controls', { timeout: 5_000 }, async t => {
  // Given a detected playlist has installed one visible control panel
  const host = await detectedMedia(t);

  // When the user opens the external action and dismisses the local controls
  host.element('m3u8-jump').click();
  host.element('m3u8-close').click();

  // Then the opened URL retains the whole source and the dismissed panel is removed
  assert.equal(host.opened.length, 1);
  assert.equal(new URL(host.opened[0]).searchParams.get('source'), `${mediaUrl}&title=Fixture+lesson`);
  assert.equal(host.element('m3u8-download-dom'), null);
});

test('user gets controls beside a visible video and cannot open a blocked external CDN', { timeout: 5_000 }, async t => {
  // Given a visible video streams from a Bunny CDN with a page-specific title
  const host = createMediaHost(t, { markup: '<meta property="og:title" content="BTC PAF 04 Setup"><video data-visible="true" src="https://vz-example.b-cdn.net/id/playlist.m3u8"></video>' });
  await host.start();

  // When the playlist is confirmed as media
  host.network.requests[0].respond(playlist);

  // Then the panel follows the video and the external download button remains hidden
  assert.equal(host.document.querySelector('video').nextElementSibling.id, 'm3u8-download-dom');
  assert.equal(host.element('m3u8-download-dom').style.position, 'relative');
  assert.equal(host.element('m3u8-jump').style.display, 'none');
  host.element('m3u8-copy-command').click();
  assert.match(host.copied[0], /Video 04 Setup\.\%\(ext\)s/);
});

test('user toggles deduplicated MP4 downloads and downloads the selected filename', { timeout: 5_000 }, async t => {
  // Given a media page contains two occurrences of the same MP4 URL
  const url = 'https://cdn.example/lesson.mp4?expires=123';
  const host = createMediaHost(t, { markup: `<video src="${url}"></video><video src="${url}"></video>` });
  await host.start();

  // When the user opens the MP4 list, selects its item, and closes the list
  host.element('mp4-show').click();
  assert.equal(host.element('mp4-download-dom').children.length, 1);
  host.element('mp4-download-dom').firstElementChild.click();
  host.element('mp4-show').click();

  // Then one named download is captured and toggling removes the list
  assert.deepEqual(host.downloads.map(({ name, url }) => ({ name, url })), [{ name: 'lesson.mp4', url }]);
  assert.equal(host.element('mp4-download-dom'), null);
  assert.equal(host.element('mp4-show').textContent, 'MP4下载');
});

test('user intercepts media XHR without dropping original open arguments or reinstalling the wrapper', { timeout: 5_000 }, async t => {
  // Given the installed userscript owns the page XMLHttpRequest wrapper
  const host = createMediaHost(t);
  await host.start();
  const wrapped = host.window.XMLHttpRequest;

  // When a host request opens a playlist URL through that wrapper
  const xhr = new host.window.XMLHttpRequest();
  xhr.open('GET', mediaUrl, false, undefined, undefined);
  xhr.send('fixture request body');
  host.network.requests[0].respond(playlist);
  await host.start();

  // Then the real request keeps every argument and reinjection preserves the wrapper
  assert.deepEqual(xhr.args, ['GET', mediaUrl, false, undefined, undefined]);
  assert.equal(xhr.body, 'fixture request body');
  assert.equal(host.window.XMLHttpRequest, wrapped);
  assert.equal(host.window.XMLHttpRequest.DONE, 4);
  assert.equal(host.element('m3u8-copy-command').style.display, 'block');
});

test('user accepts only matching iframe media messages and anchors controls beside the referring frame', { timeout: 5_000 }, async t => {
  // Given a page owns a known media iframe and no detected top-level playlist
  const referer = 'https://iframe.mediadelivery.net/embed/1/fixture-video';
  const host = createMediaHost(t, { markup: `<title>Fixture lesson</title><iframe src="${referer}"></iframe>` });
  await host.start();
  const frame = host.document.querySelector('iframe');
  const message = (origin, source, data) => host.window.dispatchEvent(new host.window.MessageEvent('message', { origin, source, data }));

  // When unrelated messages are rejected before a matching frame reports media
  message('https://attacker.example', frame.contentWindow, { type: 'jh-userscripts:m3u8-detected', url: mediaUrl });
  message('https://iframe.mediadelivery.net', frame.contentWindow, { type: 'unrelated', url: mediaUrl });
  assert.equal(host.element('m3u8-download-dom'), null);
  message('https://iframe.mediadelivery.net', frame.contentWindow, { type: 'jh-userscripts:m3u8-detected', url: mediaUrl, referer });

  // Then the panel follows the authenticated source frame and copies its referer
  assert.equal(frame.nextElementSibling.id, 'm3u8-download-dom');
  host.element('m3u8-copy-command').click();
  assert.equal(host.copied[0], `yt-dlp --referer '${referer}' -N 16 -o 'Fixture lesson.%(ext)s' '${mediaUrl}'`);
});

test('user injects a sanitized downloader and receives captions from the detected media host', { timeout: 5_000 }, async t => {
  // Given a recognized playlist provides the actual host and query parameters
  const host = await detectedMedia(t);

  // When the user injects the downloader and its modeled resources complete
  host.element('m3u8-append').click();
  const captions = host.network.requests.filter(request => request.url.includes('/captions/'));
  assert.equal(captions.length, 2);
  captions.forEach(request => request.respond('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFixture\n'));
  const html = '<div id="fixture-downloader"><p>Download ready</p><script>unwanted()</script><a href="https://segmentfault.com/x">Promotion</a></div><!--vue 前端框架-->// script注入window.fixtureDownloader = {url: \'\', // 在线链接\n}; // script注入<!--vue 前端框架-->';
  host.network.requests.find(request => request.url.includes('index.html')).respond(html);
  for (const filename of ['stream-saver.js', 'mux-mp4.js', 'aes-decryptor.js', 'vue.js']) {
    const request = host.network.requests.find(request => request.url.endsWith(filename));
    assert.ok(request, `the ${filename} request must follow the previous completion`);
    request.respond('/* Offline library boundary. */');
  }
  await afterDataMediaResponseTurn();

  // Then both caption downloads retain the query and the injected UI has no promotional nodes
  assert.deepEqual(captions.map(request => request.url).sort(), [
    'https://cdn.example/lesson/captions/CN.vtt?token=fixture&expires=100',
    'https://cdn.example/lesson/captions/EN.vtt?token=fixture&expires=100',
  ]);
  assert.deepEqual(host.downloads.map(download => download.name).sort(), ['Fixture lesson.en.vtt', 'Fixture lesson.zh.vtt']);
  assert.equal(await host.downloads[0].blob.text(), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFixture\n');
  assert.equal(host.element('fixture-downloader').querySelector('script,a'), null);
  assert.equal(host.window.fixtureDownloader.url, `${mediaUrl}&title=Fixture+lesson`);
  assert.equal(host.blobs.size, 0);
  assert.equal(host.revoked.length, 2);
  assert.deepEqual(host.alerts, ['注入成功，请滚动到页面底部']);
});
