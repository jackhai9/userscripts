import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  buildBrooksMediaExportPayload,
  canRetryFailedBrooksMediaExport,
  formatBrooksMediaExportStatus,
  getBrooksMediaExportPageLabel,
  isBrooksMediaExportComplete,
  shouldShowBrooksMediaExportReset,
  stopBrooksMediaExportRunTimer,
  truncateBrooksMediaExportText,
} from '../../src/m3u8-downloader/brooks-status.js';
import {
  extractBrooksMediaExportPageInfo,
  getBrooksCourseVideoLinks,
} from '../../src/m3u8-downloader/brooks-pages.js';
import { buildBrooksMediaIndexRecord } from '../../src/m3u8-downloader/brooks-record.js';
import { buildCaptionUrlFromM3u8, getBrooksVideoIdFromM3u8 } from '../../src/m3u8-downloader/media-url.js';
import { isTrustedFrameMessage } from '../../src/m3u8-downloader/frame-message.js';

const timestamp = Date.UTC(2026, 8, 16);
const courseUrl = 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/';

test('user sees empty labels when saved course metadata has no page identity', () => {
  // Given an old status record has no URL or readable title
  const missing = [undefined, null, ''];

  // When both public label formatters receive the absent metadata
  const labels = missing.map(value => [getBrooksMediaExportPageLabel(value), truncateBrooksMediaExportText(value, 40)]);

  // Then the compact status contains no invented page name or stringified null value
  assert.deepEqual(labels, [['', ''], ['', ''], ['', '']]);
});

test('user preserves the known active interval when pausing old progress without a usable accumulator', () => {
  // Given older saved progress has a valid active start and missing or nonnumeric accumulated time
  const states = [undefined, '2500', Number.NaN, Number.POSITIVE_INFINITY].map(activeElapsedMs => ({
    running: true, activeRunStartedAt: new Date(timestamp).toISOString(), activeElapsedMs,
  }));

  // When pause occurs four seconds after the known active start
  const elapsed = states.map(state => stopBrooksMediaExportRunTimer(state, timestamp + 4_000));

  // Then every result contains exactly that active interval and consumes its start marker
  assert.deepEqual(elapsed, [4_000, 4_000, 4_000, 4_000]);
  assert.deepEqual(states.map(state => state.activeElapsedMs), [4_000, 4_000, 4_000, 4_000]);
  assert.deepEqual(states.map(state => Object.hasOwn(state, 'activeRunStartedAt')), [false, false, false, false]);
});

test('user sees a pending course position without claiming unknown totals or elapsed runtime', t => {
  // Given partial saved metadata retains only its normal cursor and a pending page start
  t.mock.timers.enable({ apis: ['Date'], now: timestamp + 4_900 });
  const state = { running: true, index: 2 };
  const pending = { url: courseUrl, startedAt: timestamp };

  // When the status is displayed without a separately supplied clock or result arrays
  const status = formatBrooksMediaExportStatus({ state, pending });

  // Then the pending page uses the retained cursor and the current clock without fabricated runtime
  assert.equal(status, '采集中 0/0 | 成功 0 | 失败 0\n当前 3/0 video-01-terminology | 等待 4s');
});

test('user sees the first pending course without a wait claim when its start time is unavailable', () => {
  // Given an interrupted collection has its course list but no cursor or pending start timestamp
  const state = { running: true, links: [courseUrl] };

  // When status is reconstructed with only the pending page URL
  const status = formatBrooksMediaExportStatus({ state, pending: { url: courseUrl }, now: timestamp });

  // Then the first page is identified without inventing a wait duration
  assert.equal(status, '采集中 0/1 | 成功 0 | 失败 0\n当前 1/1 video-01-terminology');
});

test('user can discard incomplete saved progress without being offered retry or completion', () => {
  // Given stored progress contains its course list but no successes or failures yet
  const state = { running: false, links: [courseUrl] };

  // When completion, retry, and discard eligibility are derived from that state
  const controls = {
    complete: isBrooksMediaExportComplete(state),
    retry: canRetryFailedBrooksMediaExport(state),
    reset: shouldShowBrooksMediaExportReset(state),
  };

  // Then the user can discard the incomplete collection without a false completion or retry option
  assert.deepEqual(controls, { complete: false, retry: false, reset: true });
});

test('user receives no discard prompt from malformed non-array progress containers', () => {
  // Given saved metadata contains no usable course or result arrays
  const state = { running: false, links: 'unavailable', records: {}, failures: {} };

  // When discard visibility inspects this uninitialized collection metadata
  const visible = shouldShowBrooksMediaExportReset(state);

  // Then invalid containers do not masquerade as a nonempty collection
  assert.equal(visible, false);
});

test('user exports active runtime from the current clock when the requested timestamp cannot be parsed', t => {
  // Given a running export has two seconds of saved work and three seconds of current activity
  t.mock.timers.enable({ apis: ['Date'], now: timestamp + 3_000 });
  const state = {
    links: [courseUrl], records: [], failures: [], index: 0, running: true,
    activeElapsedMs: 2_000, activeRunStartedAt: new Date(timestamp).toISOString(),
  };

  // When a payload is built with an unavailable caller timestamp
  const payload = buildBrooksMediaExportPayload(state, 'unavailable');

  // Then measured runtime remains concrete while the supplied timestamp retains its original value
  assert.equal(payload.exportedAt, 'unavailable');
  assert.equal(payload.elapsedMs, 5_000);
  assert.equal(payload.elapsedSeconds, 5);
  assert.equal(payload.elapsedText, '5s');
  assert.deepEqual(payload.missingIndexes, [0]);
  assert.equal(payload.completed, false);
});

for (const source of ['https://media.example/playlist.m3u8', 'https://media.example/course/master.m3u8']) {
  test(`user receives a caption-path error for the unsupported media path ${new URL(source).pathname}`, () => {
    // Given the detected media URL has no supported video-directory and playlist pairing
    const url = `${source}?expires=100`;

    // When a caption URL and its video identity are requested
    const inferCaption = () => buildCaptionUrlFromM3u8(url, 'CN.vtt');
    const videoId = getBrooksVideoIdFromM3u8(url);

    // Then captions fail explicitly and the absent video identifier remains empty
    assert.throws(inferCaption, { message: 'Unable to infer caption path from m3u8 URL' });
    assert.equal(videoId, '');
  });
}

test('user does not mistake a resolution directory for a missing Brooks video identifier', () => {
  // Given a detected URL has a resolution and playlist but no parent video directory
  const url = 'https://media.example/1920x1080/video.m3u8';

  // When the public media identity parser inspects the URL
  const videoId = getBrooksVideoIdFromM3u8(url);

  // Then the resolution is never presented as a video identifier
  assert.equal(videoId, '');
});

for (const scenario of [
  { name: 'the media query title', suffix: '?title=Media+lesson', title: 'Media lesson', output: 'Media lesson.%(ext)s' },
  { name: 'no available title', suffix: '', title: '', output: '.%(ext)s' },
]) {
  test(`user retains ${scenario.name} in a media index record without a page title`, () => {
    // Given detection supplies a valid video URL but omits page title and referer metadata
    const options = { pageUrl: courseUrl, m3u8Url: `https://media.example/video-id/playlist.m3u8${scenario.suffix}` };

    // When the public record builder derives export fields from that detection
    const record = buildBrooksMediaIndexRecord(options);

    // Then only actual title data is retained and all media URLs refer to the detected host
    assert.deepEqual(record, {
      ok: true, url: courseUrl, title: scenario.title, mediaTitle: scenario.title, pageUrl: courseUrl,
      output: scenario.output, referer: '', m3u8: 'https://media.example/video-id/playlist.m3u8',
      videoId: 'video-id', cn: 'https://media.example/video-id/captions/CN.vtt',
      en: 'https://media.example/video-id/captions/EN.vtt', index: undefined,
    });
  });
}

test('user can inspect a media page with an embed and no title metadata', t => {
  // Given the parsed course response contains its player but neither document nor Open Graph title
  const dom = new JSDOM('<iframe src="https://iframe.mediadelivery.net/embed/123/video-id"></iframe>');
  t.after(() => dom.window.close());

  // When the exported page parser reads the real response DOM
  const info = extractBrooksMediaExportPageInfo(dom.window.document, courseUrl);

  // Then the embed and page identity are retained while title remains explicitly empty
  assert.deepEqual(info, {
    pageUrl: courseUrl, title: '', embedSrc: 'https://iframe.mediadelivery.net/embed/123/video-id',
  });
});

test('user resolves relative course links from a detached parsed section against the current page', t => {
  // Given course markup is a detached section without its own browsing context
  const dom = new JSDOM('<section><a href="../video-01-terminology/#intro">Lesson</a><a href="../video-01-terminology/#end">Duplicate</a></section>');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://www.brookstradingcourse.com/price-action-fundamentals/section/') });
  t.after(() => {
    dom.window.close();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete globalThis.location;
  });

  // When link discovery reads the detached DOM root
  const links = getBrooksCourseVideoLinks(dom.window.document.querySelector('section'));

  // Then the current page resolves relative URLs and fragment-only duplicates collapse
  assert.deepEqual(links, [courseUrl]);
});

test('user rejects an originless media message even when it comes from a current iframe', t => {
  // Given the page owns an actual iframe from a known media origin
  const dom = new JSDOM('<iframe src="https://iframe.mediadelivery.net/embed/123/video-id"></iframe>', { url: courseUrl });
  t.after(() => dom.window.close());
  const source = dom.window.document.querySelector('iframe').contentWindow;

  // When trust checks compare an originless message and one with the frame origin
  const results = [
    isTrustedFrameMessage(dom.window.document, { source, origin: '' }),
    isTrustedFrameMessage(dom.window.document, { source, origin: 'https://iframe.mediadelivery.net' }),
  ];

  // Then source identity alone does not authorize the originless message
  assert.deepEqual(results, [false, true]);
});
