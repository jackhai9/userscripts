import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildCaptionUrlFromM3u8 } from '../../src/m3u8-downloader/media-url.js';
import {
  buildBrooksMediaExportEmbedUrl,
  extractBrooksMediaExportPageInfo,
  getBrooksCourseVideoLinks,
} from '../../src/m3u8-downloader/brooks-pages.js';
import { buildBrooksMediaIndexRecord } from '../../src/m3u8-downloader/brooks-record.js';
import {
  buildBrooksMediaExportPayload,
  formatBrooksMediaExportStatus,
  markBrooksMediaExportRunStarted,
  stopBrooksMediaExportRunTimer,
} from '../../src/m3u8-downloader/brooks-status.js';

const source = await readFile(new URL('../../scripts/m3u8-downloader.user.js', import.meta.url), 'utf8');

test('Brooks course exporter collects unique course video links from the index page', () => {
  const dom = new JSDOM(`
    <a href="/trade-price-action/">Course index</a>
    <a href="/video-course-table-of-contents/">Table of contents</a>
    <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
    <a href="https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/">Duplicate</a>
    <a href="https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/?ref=nav">Video 02A</a>
    <a href="https://www.brookstradingcourse.com/bonus-videos/trading-patterns-on-the-open/">Bonus video</a>
    <a href="https://example.com/price-action-fundamentals/video-99/">Other site</a>
  `, { url: 'https://www.brookstradingcourse.com/main-course-videos/' });

  assert.deepEqual(getBrooksCourseVideoLinks(dom.window.document), [
    'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
    'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/?ref=nav',
    'https://www.brookstradingcourse.com/bonus-videos/trading-patterns-on-the-open/',
  ]);
});

test('Brooks media index records derive current m3u8, caption URLs, and yt-dlp output', () => {
  const m3u8Url = 'https://vz-other.b-cdn.net/abc123/1920x1080/video.m3u8?token=keep&title=Video%2022A%20Major%20Trend%20Reversals';

  const record = buildBrooksMediaIndexRecord({
    pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-22a-major-trend-reversals/',
    title: 'Video 22A Major Trend Reversals | Brooks Trading Course',
    referer: 'https://iframe.mediadelivery.net/embed/155631/abc123?autoplay=false',
    m3u8Url,
    index: 72,
  });

  assert.equal(record.ok, true);
  assert.equal(record.index, 72);
  assert.equal(record.title, 'Video 22A Major Trend Reversals | Brooks Trading Course');
  assert.equal(record.mediaTitle, 'Video 22A Major Trend Reversals');
  assert.equal(record.videoId, 'abc123');
  assert.equal(record.output, 'Video 22A Major Trend Reversals.%(ext)s');
  assert.equal(record.m3u8, 'https://vz-other.b-cdn.net/abc123/1920x1080/video.m3u8?token=keep');
  assert.equal(record.cn, 'https://vz-other.b-cdn.net/abc123/captions/CN.vtt?token=keep');
  assert.equal(record.en, 'https://vz-other.b-cdn.net/abc123/captions/EN.vtt?token=keep');
  assert.equal(record.referer, 'https://iframe.mediadelivery.net/embed/155631/abc123?autoplay=false');
  assert.equal(buildCaptionUrlFromM3u8('https://vz-other.b-cdn.net/abc123/playlist.m3u8?token=keep&title=drop', 'CN.vtt'), 'https://vz-other.b-cdn.net/abc123/captions/CN.vtt?token=keep');
});

test('Brooks media export payload marks incomplete exports and missing indexes', () => {
  const payload = buildBrooksMediaExportPayload({
    links: ['a', 'b', 'c', 'd'],
    index: 2,
    running: true,
    stopped: false,
    records: [{ index: 0 }, { index: 2 }],
    failures: [{ index: 3 }],
  }, '2026-06-03T00:00:00.000Z');

  assert.equal(payload.exportedAt, '2026-06-03T00:00:00.000Z');
  assert.equal(payload.total, 4);
  assert.equal(payload.done, 3);
  assert.equal(payload.completed, false);
  assert.equal(payload.nextIndex, 2);
  assert.deepEqual(payload.missingIndexes, [1]);
  assert.equal(payload.records.length, 2);
  assert.equal(payload.failures.length, 1);
});

test('Brooks media export payload includes elapsed runtime metadata', () => {
  const payload = buildBrooksMediaExportPayload({
    links: ['a'],
    index: 1,
    running: false,
    stopped: false,
    records: [{ index: 0 }],
    failures: [],
    startedAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:01:12.000Z',
    activeElapsedMs: 72_000,
  }, '2026-06-03T00:02:00.000Z');

  assert.equal(payload.startedAt, '2026-06-03T00:00:00.000Z');
  assert.equal(payload.updatedAt, '2026-06-03T00:01:12.000Z');
  assert.equal(payload.elapsedMs, 72_000);
  assert.equal(payload.elapsedSeconds, 72);
  assert.equal(payload.elapsedText, '1m12s');
});

test('Brooks media export elapsed runtime excludes paused wall-clock time', () => {
  const state = {
    links: ['a'],
    index: 1,
    running: false,
    stopped: false,
    records: [{ index: 0 }],
    failures: [],
    startedAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T01:25:46.000Z',
    activeElapsedMs: 0,
  };

  markBrooksMediaExportRunStarted(state, 1_000);
  stopBrooksMediaExportRunTimer(state, 11_000);
  markBrooksMediaExportRunStarted(state, 3_600_000);
  stopBrooksMediaExportRunTimer(state, 3_605_000);

  const payload = buildBrooksMediaExportPayload(state, '2026-06-03T01:25:46.000Z');
  assert.equal(payload.elapsedMs, 15_000);
  assert.equal(payload.elapsedSeconds, 15);
  assert.equal(payload.elapsedText, '15s');
});

test('Brooks media export parses page HTML and builds a direct Bunny embed URL', () => {
  const pageUrl = 'https://www.brookstradingcourse.com/price-action-fundamentals/video-04-setup/';
  const dom = new JSDOM(`
    <meta property="og:title" content="BTC PAF 04 My Setup">
    <iframe src="https://iframe.mediadelivery.net/embed/155631/2e5c1767-6405-4d95-9d60-33238a4475c5?autoplay=false&loop=false&muted=false&preload=true"></iframe>
  `, { url: pageUrl });

  const info = extractBrooksMediaExportPageInfo(dom.window.document, pageUrl);
  assert.equal(info.title, 'Video 04 My Setup');
  assert.equal(info.pageUrl, pageUrl);
  assert.equal(info.embedSrc, 'https://iframe.mediadelivery.net/embed/155631/2e5c1767-6405-4d95-9d60-33238a4475c5?autoplay=false&loop=false&muted=false&preload=true');

  const embedUrl = new URL(buildBrooksMediaExportEmbedUrl(info));
  assert.equal(embedUrl.origin, 'https://iframe.mediadelivery.net');
  assert.equal(embedUrl.searchParams.get('jhBrooksPageUrl'), pageUrl);
  assert.equal(embedUrl.searchParams.get('jhBrooksTitle'), 'Video 04 My Setup');
});

test('Brooks media export accepts direct Bunny iframe m3u8 messages only for pending page', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-04-setup/">Video 04</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  class FakeXHR {
    open(method, url) {
      this.url = url;
    }

    send() {
      this.status = 200;
      this.responseText = `
        <meta property="og:title" content="BTC PAF 04 My Setup">
        <iframe src="https://iframe.mediadelivery.net/embed/155631/2e5c1767-6405-4d95-9d60-33238a4475c5?autoplay=false&loop=false&muted=false&preload=true"></iframe>
      `;
      setTimeout(() => this.onload(), 0);
    }
  }
  window.XMLHttpRequest = FakeXHR;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  window.document.querySelector('#brooks-media-export-primary').click();
  await new Promise(resolve => setTimeout(resolve, 20));

  const frame = window.document.querySelector('iframe[src*="iframe.mediadelivery.net/embed/"]');
  assert.equal(frame !== null, true);
  assert.equal(new URL(frame.src).searchParams.get('jhBrooksPageUrl'), 'https://www.brookstradingcourse.com/price-action-fundamentals/video-04-setup/');

  window.dispatchEvent(new window.MessageEvent('message', {
    origin: 'https://iframe.mediadelivery.net',
    source: frame.contentWindow,
    data: {
      type: 'jh-userscripts:m3u8-detected',
      url: 'https://vz-9a847249-45e.b-cdn.net/2e5c1767-6405-4d95-9d60-33238a4475c5/1920x1080/video.m3u8?title=Video+04+My+Setup',
      referer: frame.src,
      brooksExport: {
        pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-04-setup/',
        title: 'Video 04 My Setup',
      },
    },
  }));

  await new Promise(resolve => setTimeout(resolve, 20));
  const exported = JSON.parse(window.localStorage.getItem('jh-userscripts:brooks-media-index-export'));
  assert.equal(exported.records.length, 1);
  assert.equal(exported.records[0].pageUrl, 'https://www.brookstradingcourse.com/price-action-fundamentals/video-04-setup/');
  assert.equal(exported.records[0].mediaTitle, 'Video 04 My Setup');
  assert.equal(exported.records[0].videoId, '2e5c1767-6405-4d95-9d60-33238a4475c5');
});

test('Brooks media export status separates success, failures, current page, and elapsed time', () => {
  const text = formatBrooksMediaExportStatus({
    state: {
      running: true,
      stopped: false,
      startedAt: '1970-01-01T00:00:01.000Z',
      activeElapsedMs: 0,
      activeRunStartedAt: '1970-01-01T00:00:01.000Z',
      links: [
        'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
        'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
        'https://www.brookstradingcourse.com/price-action-fundamentals/video-04-setup/',
      ],
      index: 2,
      records: [{ ok: true }, { ok: true }],
      failures: [{ ok: false, url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/', error: 'm3u8 detection timeout' }],
    },
    pending: {
      index: 2,
      url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-04-setup/',
      startedAt: 1_000,
    },
    now: 13_400,
  });

  assert.equal(text, '采集中 3/3 | 成功 2 | 失败 1\n耗时: 12s\n当前 3/3 video-04-setup | 等待 12s\n最近失败: m3u8 detection timeout');
});

test('Brooks media export status prompts failure recovery after collection finishes', () => {
  const text = formatBrooksMediaExportStatus({
    state: {
      running: false,
      stopped: false,
      startedAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:01:12.000Z',
      activeElapsedMs: 72_000,
      links: ['a', 'b', 'c'],
      index: 3,
      records: [{ ok: true }, { ok: true }],
      failures: [{ ok: false, index: 1, url: 'b', error: 'm3u8 detection timeout' }],
    },
  });

  assert.equal(text, '已完成 3/3 | 成功 2 | 失败 1\n耗时: 1m12s\n最近失败: m3u8 detection timeout\n请点“重试失败”；仍失败再导出 JSON');
});

test('Brooks media export status truncates very long page labels', () => {
  const text = formatBrooksMediaExportStatus({
    state: {
      running: true,
      stopped: false,
      links: ['https://www.brookstradingcourse.com/price-action-fundamentals/video-999-this-title-is-way-too-long-for-the-compact-export-panel/'],
      index: 0,
      records: [],
      failures: [],
    },
    pending: {
      index: 0,
      url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-999-this-title-is-way-too-long-for-the-compact-export-panel/',
      startedAt: 1_000,
    },
    now: 2_000,
  });

  assert.equal(text, '采集中 0/1 | 成功 0 | 失败 0\n当前 1/1 video-999-this-title-is-way-too-long-fo… | 等待 1s');
});

test('Brooks course index page renders a media export panel without starting collection', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
      <a href="/price-action-fundamentals/video-02a-chart-basics-price-action/">Video 02A</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(window.document.querySelector('#brooks-media-export-dom') !== null, true);
  assert.equal(window.document.querySelector('#brooks-media-export-primary')?.textContent, '开始');
  assert.equal(window.document.querySelector('#brooks-media-export-resume'), null);
  assert.equal(window.document.querySelector('#brooks-media-export-pause'), null);
  assert.equal(window.document.querySelector('#brooks-media-export-reset')?.textContent, '重置');
  assert.equal(window.document.querySelector('#brooks-media-export-reset')?.style.display, 'none');
  assert.equal(window.document.querySelector('#brooks-media-export-status')?.textContent, '发现 2 个视频页');
  assert.equal(window.document.querySelectorAll('iframe').length, 0);
});

test('Brooks media export panel keeps stable dimensions while status text changes', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));

  const panel = window.document.querySelector('#brooks-media-export-dom');
  const status = window.document.querySelector('#brooks-media-export-status');
  const actions = window.document.querySelector('#brooks-media-export-actions');

  assert.equal(panel?.style.width, '380px');
  assert.equal(panel?.style.minHeight, '');
  assert.equal(status?.style.height, '82px');
  assert.equal(status?.style.overflowWrap, 'anywhere');
  assert.equal(status?.style.overflow, 'hidden');
  assert.equal(actions?.style.display, 'flex');
  assert.equal(actions?.style.minHeight, '32px');
});

test('Brooks media export primary button toggles start, pause, and resume labels', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  const primary = window.document.querySelector('#brooks-media-export-primary');
  const reset = window.document.querySelector('#brooks-media-export-reset');

  primary.click();
  assert.equal(primary.textContent, '暂停');
  assert.equal(reset.style.display, 'none');
  assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /采集中/);

  primary.click();
  assert.equal(primary.textContent, '继续');
  assert.equal(reset.style.display, '');
  assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /已暂停/);

  primary.click();
  assert.equal(primary.textContent, '暂停');
  assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /采集中/);

  primary.click();
});

test('Brooks media export reset clears saved progress and returns to initial discovered state', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
      <a href="/price-action-fundamentals/video-02a-chart-basics-price-action/">Video 02A</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  window.document.querySelector('#brooks-media-export-primary').click();

  try {
    window.document.querySelector('#brooks-media-export-primary').click();

    assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /已暂停/);
    assert.equal(window.document.querySelectorAll('iframe').length, 0);

    window.document.querySelector('#brooks-media-export-reset').click();

    assert.equal(window.document.querySelector('#brooks-media-export-status')?.textContent, '发现 2 个视频页');
    assert.equal(window.document.querySelector('#brooks-media-export-primary')?.textContent, '开始');
    assert.equal(window.localStorage.getItem('jh-userscripts:brooks-media-index-export'), null);
    assert.equal(window.document.querySelectorAll('iframe').length, 0);
  } finally {
    if (window.document.querySelector('#brooks-media-export-primary')?.textContent === '暂停') {
      window.document.querySelector('#brooks-media-export-primary')?.click();
    }
  }
});

test('Brooks media export hides reset after a complete successful collection', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
      <a href="/price-action-fundamentals/video-02a-chart-basics-price-action/">Video 02A</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('jh-userscripts:brooks-media-index-export', JSON.stringify({
    running: false,
    stopped: false,
    schemaVersion: 2,
    links: [
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
    ],
    index: 2,
    records: [
      { ok: true, index: 0, url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/' },
      { ok: true, index: 1, url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/' },
    ],
    failures: [],
  }));
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /已完成 2\/2 \| 成功 2 \| 失败 0/);
  assert.equal(window.document.querySelector('#brooks-media-export-reset')?.style.display, 'none');
  assert.equal(window.document.querySelector('#brooks-media-export-reset-help')?.style.display, 'none');
});

test('Brooks media export explains reset only when discarding progress is useful', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
      <a href="/price-action-fundamentals/video-02a-chart-basics-price-action/">Video 02A</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('jh-userscripts:brooks-media-index-export', JSON.stringify({
    running: false,
    stopped: true,
    schemaVersion: 2,
    links: [
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
    ],
    index: 1,
    records: [
      { ok: true, index: 0, url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/' },
    ],
    failures: [],
  }));
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));

  const resetHelp = window.document.querySelector('#brooks-media-export-reset-help');
  assert.equal(window.document.querySelector('#brooks-media-export-reset')?.style.display, '');
  assert.equal(resetHelp?.style.display, '');
  assert.equal(resetHelp?.textContent, '重置会清空当前进度和结果，不会自动开始；要放弃中断进度或失败记录时再点。');
});

test('Brooks media export retries only failed pages and keeps successful records', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
      <a href="/price-action-fundamentals/video-02a-chart-basics-price-action/">Video 02</a>
      <a href="/bonus-videos/trading-patterns-on-the-open/">Bonus</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('jh-userscripts:brooks-media-index-export', JSON.stringify({
    running: false,
    stopped: false,
    schemaVersion: 2,
    links: [
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
      'https://www.brookstradingcourse.com/bonus-videos/trading-patterns-on-the-open/',
    ],
    index: 3,
    records: [
      {
        ok: true,
        index: 0,
        url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
        pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      },
      {
        ok: true,
        index: 2,
        url: 'https://www.brookstradingcourse.com/bonus-videos/trading-patterns-on-the-open/',
        pageUrl: 'https://www.brookstradingcourse.com/bonus-videos/trading-patterns-on-the-open/',
      },
    ],
    failures: [
      {
        ok: false,
        index: 1,
        url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
        error: 'm3u8 detection timeout',
      },
    ],
  }));
  class FakeXHR {
    open(method, url) {
      this.url = url;
    }

    send() {
      this.status = 200;
      this.responseText = `
        <meta property="og:title" content="BTC PAF 02A Chart Basics">
        <iframe src="https://iframe.mediadelivery.net/embed/155631/retry-video-id?autoplay=false&loop=false&muted=false&preload=true"></iframe>
      `;
      setTimeout(() => this.onload(), 0);
    }
  }
  window.XMLHttpRequest = FakeXHR;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));

  const retryButton = window.document.querySelector('#brooks-media-export-retry-failed');
  const resetButton = window.document.querySelector('#brooks-media-export-reset');
  const resetHelp = window.document.querySelector('#brooks-media-export-reset-help');
  assert.equal(retryButton?.textContent, '重试失败');
  assert.equal(resetButton?.style.display, '');
  assert.equal(resetHelp?.style.display, '');
  retryButton.click();
  await new Promise(resolve => setTimeout(resolve, 20));

  let saved = JSON.parse(window.localStorage.getItem('jh-userscripts:brooks-media-index-export'));
  assert.equal(saved.records.length, 2);
  assert.equal(saved.links.length, 3);
  assert.deepEqual(saved.retryQueue, [1]);
  assert.equal(saved.index, 3);
  assert.equal(saved.failures.length, 0);

  const frame = window.document.querySelector('iframe[src*="iframe.mediadelivery.net/embed/"]');
  assert.equal(frame !== null, true);
  assert.equal(new URL(frame.src).searchParams.get('jhBrooksPageUrl'), 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/');

  window.dispatchEvent(new window.MessageEvent('message', {
    origin: 'https://iframe.mediadelivery.net',
    source: frame.contentWindow,
    data: {
      type: 'jh-userscripts:m3u8-detected',
      url: 'https://vz-9a847249-45e.b-cdn.net/retry-video-id/1920x1080/video.m3u8?title=Video+02A+Chart+Basics',
      referer: frame.src,
      brooksExport: {
        pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
        title: 'Video 02A Chart Basics',
      },
    },
  }));

  await new Promise(resolve => setTimeout(resolve, 20));
  saved = JSON.parse(window.localStorage.getItem('jh-userscripts:brooks-media-index-export'));
  assert.equal(saved.records.length, 3);
  assert.equal(saved.failures.length, 0);
  assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /已完成 3\/3 \\| 成功 3 \\| 失败 0/);
});

test('Brooks media export does not offer failed retry before collection is complete', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
      <a href="/price-action-fundamentals/video-02a-chart-basics-price-action/">Video 02</a>
      <a href="/bonus-videos/trading-patterns-on-the-open/">Bonus</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('jh-userscripts:brooks-media-index-export', JSON.stringify({
    running: false,
    stopped: true,
    schemaVersion: 2,
    links: [
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
      'https://www.brookstradingcourse.com/bonus-videos/trading-patterns-on-the-open/',
    ],
    index: 2,
    records: [
      {
        ok: true,
        index: 0,
        url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
        pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      },
    ],
    failures: [
      {
        ok: false,
        index: 1,
        url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
        error: 'm3u8 detection timeout',
      },
    ],
  }));
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));

  const retryButton = window.document.querySelector('#brooks-media-export-retry-failed');
  assert.equal(retryButton?.style.display, 'none');
  retryButton.click();
  await new Promise(resolve => setTimeout(resolve, 20));

  const saved = JSON.parse(window.localStorage.getItem('jh-userscripts:brooks-media-index-export'));
  assert.equal(saved.stopped, true);
  assert.equal(saved.running, false);
  assert.equal(saved.retryQueue, undefined);
  assert.equal(saved.index, 2);
  assert.equal(saved.failures.length, 1);
});

test('Brooks media export retry drains queue for same-origin record messages', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-01-terminology/">Video 01</a>
      <a href="/price-action-fundamentals/video-02a-chart-basics-price-action/">Video 02</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.localStorage.setItem('jh-userscripts:brooks-media-index-export', JSON.stringify({
    running: false,
    stopped: false,
    schemaVersion: 2,
    links: [
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
    ],
    index: 2,
    records: [
      {
        ok: true,
        index: 0,
        url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
        pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-01-terminology/',
      },
    ],
    failures: [
      {
        ok: false,
        index: 1,
        url: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
        error: 'm3u8 detection timeout',
      },
    ],
  }));
  class FakeXHR {
    open(method, url) {
      this.url = url;
    }

    send() {
      this.status = 200;
      this.responseText = `
        <meta property="og:title" content="BTC PAF 02A Chart Basics">
        <iframe src="https://iframe.mediadelivery.net/embed/155631/retry-video-id?autoplay=false&loop=false&muted=false&preload=true"></iframe>
      `;
      setTimeout(() => this.onload(), 0);
    }
  }
  window.XMLHttpRequest = FakeXHR;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  window.document.querySelector('#brooks-media-export-retry-failed').click();
  await new Promise(resolve => setTimeout(resolve, 20));

  window.dispatchEvent(new window.MessageEvent('message', {
    origin: 'https://www.brookstradingcourse.com',
    data: {
      type: 'jh-userscripts:brooks-media-index-record',
      record: {
        ok: true,
        pageUrl: 'https://www.brookstradingcourse.com/price-action-fundamentals/video-02a-chart-basics-price-action/',
        m3u8: 'https://vz-9a847249-45e.b-cdn.net/retry-video-id/1920x1080/video.m3u8',
      },
    },
  }));

  await new Promise(resolve => setTimeout(resolve, 650));
  const saved = JSON.parse(window.localStorage.getItem('jh-userscripts:brooks-media-index-export'));
  assert.equal(saved.records.length, 2);
  assert.equal(saved.failures.length, 0);
  assert.equal(saved.retryQueue, undefined);
  assert.equal(saved.running, false);
});

test('Brooks media export status refreshes elapsed time while waiting for a page', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-04-setup/">Video 04</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let now = 1_000;
  window.Date.now = () => now;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  window.document.querySelector('#brooks-media-export-primary').click();

  try {
    assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /等待 0s/);
    now = 3_400;
    await new Promise(resolve => setTimeout(resolve, 1100));

    assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /等待 2s/);
  } finally {
    window.document.querySelector('#brooks-media-export-primary').click();
  }
});

test('Brooks media export iframe uses an in-viewport player-sized frame for media detection', async () => {
  const dom = new JSDOM(`
    <body>
      <a href="/price-action-fundamentals/video-04-setup/">Video 04</a>
    </body>
  `, {
    url: 'https://www.brookstradingcourse.com/main-course-videos/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  class FakeXHR {
    open(method, url) {
      this.url = url;
    }

    send() {
      this.status = 200;
      this.responseText = `
        <meta property="og:title" content="BTC PAF 04 My Setup">
        <iframe src="https://iframe.mediadelivery.net/embed/155631/2e5c1767-6405-4d95-9d60-33238a4475c5?autoplay=false&loop=false&muted=false&preload=true"></iframe>
      `;
      setTimeout(() => this.onload(), 0);
    }
  }
  window.XMLHttpRequest = FakeXHR;
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  window.document.querySelector('#brooks-media-export-primary').click();
  await new Promise(resolve => setTimeout(resolve, 20));

  try {
    const iframe = window.document.querySelector('iframe[src*="iframe.mediadelivery.net/embed/"]');
    assert.equal(iframe?.style.position, 'fixed');
    assert.equal(iframe?.style.width, '640px');
    assert.equal(iframe?.style.height, '360px');
    assert.equal(iframe?.style.right, '20px');
    assert.equal(iframe?.style.top, '20px');
    assert.equal(iframe?.style.pointerEvents, 'none');
    assert.notEqual(iframe?.style.left, '-10000px');
    assert.equal(new URL(iframe.src).searchParams.get('jhBrooksPageUrl'), 'https://www.brookstradingcourse.com/price-action-fundamentals/video-04-setup/');
  } finally {
    window.document.querySelector('#brooks-media-export-primary').click();
  }
});
