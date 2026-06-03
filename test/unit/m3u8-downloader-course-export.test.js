import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../../scripts/m3u8-downloader.user.js', import.meta.url), 'utf8');

function readFunctionSource(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} source should be closed`);
}

function loadFunctions(names) {
  const declarations = names.map(readFunctionSource).join('\n');
  return Function(`${declarations}; return { ${names.join(', ')} };`)();
}

test('Brooks course exporter collects unique course video links from the index page', () => {
  const { getBrooksCourseVideoLinks } = loadFunctions(['isBrooksHost', 'isBrooksMediaPageUrl', 'getBrooksCourseVideoLinks']);
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
  const { buildBrooksMediaIndexRecord, buildCaptionUrlFromM3u8 } = loadFunctions([
    'getCleanMediaUrl',
    'getBrooksVideoIdFromM3u8',
    'getYtDlpOutputName',
    'buildCaptionUrlFromM3u8',
    'buildBrooksMediaIndexRecord',
  ]);
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
  assert.equal(record.videoId, 'abc123');
  assert.equal(record.output, 'Video 22A Major Trend Reversals.%(ext)s');
  assert.equal(record.m3u8, 'https://vz-other.b-cdn.net/abc123/1920x1080/video.m3u8?token=keep');
  assert.equal(record.cn, 'https://vz-other.b-cdn.net/abc123/captions/CN.vtt?token=keep');
  assert.equal(record.en, 'https://vz-other.b-cdn.net/abc123/captions/EN.vtt?token=keep');
  assert.equal(record.referer, 'https://iframe.mediadelivery.net/embed/155631/abc123?autoplay=false');
  assert.equal(buildCaptionUrlFromM3u8('https://vz-other.b-cdn.net/abc123/playlist.m3u8?token=keep&title=drop', 'CN.vtt'), 'https://vz-other.b-cdn.net/abc123/captions/CN.vtt?token=keep');
});

test('Brooks media export status separates success, failures, current page, and elapsed time', () => {
  const { formatBrooksMediaExportStatus } = loadFunctions(['getBrooksMediaExportPageLabel', 'formatBrooksMediaExportStatus']);
  const text = formatBrooksMediaExportStatus({
    state: {
      running: true,
      stopped: false,
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

  assert.equal(text, '采集中 3/3 | 成功 2 | 失败 1\n当前 3/3 video-04-setup | 等待 12s\n最近失败: m3u8 detection timeout');
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
  assert.equal(window.document.querySelector('#brooks-media-export-start')?.textContent, '开始');
  assert.equal(window.document.querySelector('#brooks-media-export-status')?.textContent, '发现 2 个视频页');
  assert.equal(window.document.querySelectorAll('iframe').length, 0);
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
  window.document.querySelector('#brooks-media-export-start').click();

  try {
    assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /等待 0s/);
    now = 3_400;
    await new Promise(resolve => setTimeout(resolve, 1100));

    assert.match(window.document.querySelector('#brooks-media-export-status')?.textContent || '', /等待 2s/);
  } finally {
    window.document.querySelector('#brooks-media-export-stop').click();
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
  window.requestAnimationFrame = callback => callback();
  window.alert = () => {};
  window.open = () => {};

  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  window.document.querySelector('#brooks-media-export-start').click();

  try {
    const iframe = window.document.querySelector('iframe[src*="/price-action-fundamentals/video-04-setup/"]');
    assert.equal(iframe?.style.position, 'fixed');
    assert.equal(iframe?.style.width, '640px');
    assert.equal(iframe?.style.height, '360px');
    assert.equal(iframe?.style.right, '20px');
    assert.equal(iframe?.style.top, '20px');
    assert.equal(iframe?.style.pointerEvents, 'none');
    assert.notEqual(iframe?.style.left, '-10000px');
  } finally {
    window.document.querySelector('#brooks-media-export-stop').click();
  }
});
