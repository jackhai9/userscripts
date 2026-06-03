import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  auditBrooksMediaIndex,
  buildYtDlpCommand,
  parseLocalMediaFile,
  runCli,
  stripVersionSuffix,
  titleKey,
} from '../../scripts/brooks-media-audit.mjs';

test('Brooks media audit normalizes titles and version suffixes', () => {
  assert.equal(titleKey('Video 05: Program Trading v3'), 'video 05 program trading v3');
  assert.equal(stripVersionSuffix('Video 05 Program Trading v3'), 'Video 05 Program Trading');
  assert.equal(stripVersionSuffix('Video 07B Starting Out version 2'), 'Video 07B Starting Out');
});

test('Brooks media audit parses local video and subtitle filenames', () => {
  assert.deepEqual(parseLocalMediaFile('/tmp/Video 15A Breakouts v2.mp4'), {
    path: '/tmp/Video 15A Breakouts v2.mp4',
    name: 'Video 15A Breakouts v2.mp4',
    kind: 'video',
    lang: null,
    base: 'Video 15A Breakouts v2',
    key: 'video 15a breakouts v2',
    seriesKey: 'video 15a breakouts',
  });
  assert.deepEqual(parseLocalMediaFile('/tmp/Video 15A Breakouts.en.vtt'), {
    path: '/tmp/Video 15A Breakouts.en.vtt',
    name: 'Video 15A Breakouts.en.vtt',
    kind: 'subtitle',
    lang: 'en',
    base: 'Video 15A Breakouts',
    key: 'video 15a breakouts',
    seriesKey: 'video 15a breakouts',
  });
  assert.equal(parseLocalMediaFile('/tmp/notes.txt'), null);
});

test('Brooks media audit distinguishes current exact files from local variants', () => {
  const index = {
    total: 2,
    records: [
      {
        index: 0,
        output: 'Video 15A Breakouts v2.%(ext)s',
        pageUrl: 'https://example.com/video-15a/',
        m3u8: 'https://cdn.example.com/vid0/video.m3u8',
        en: 'https://cdn.example.com/vid0/captions/EN.vtt',
        cn: 'https://cdn.example.com/vid0/captions/CN.vtt',
        referer: 'https://iframe.example.com/embed/vid0',
      },
      {
        index: 1,
        output: 'Video 16A Channels.%(ext)s',
        pageUrl: 'https://example.com/video-16a/',
        m3u8: 'https://cdn.example.com/vid1/video.m3u8',
        en: 'https://cdn.example.com/vid1/captions/EN.vtt',
        cn: 'https://cdn.example.com/vid1/captions/CN.vtt',
        referer: 'https://iframe.example.com/embed/vid1',
      },
    ],
  };
  const localFiles = [
    '/videos/Video 15A Breakouts.mp4',
    '/videos/Video 15A Breakouts.en.vtt',
    '/videos/Video 16A Channels.mp4',
    '/videos/Video 16A Channels.en.vtt',
    '/videos/Video 16A Channels.zh.vtt',
  ];

  const audit = auditBrooksMediaIndex({
    index,
    indexPath: '/tmp/index.json',
    localDir: '/videos',
    localFiles,
    generatedAt: '2026-06-03T00:00:00.000Z',
  });

  assert.equal(audit.summary.records, 2);
  assert.equal(audit.summary.currentComplete, 1);
  assert.equal(audit.summary.missingCurrentVideo, 1);
  assert.equal(audit.summary.missingCurrentEn, 1);
  assert.equal(audit.summary.missingCurrentZh, 1);
  assert.equal(audit.summary.withLocalVariants, 1);

  assert.deepEqual(audit.items[0].needs, ['video', 'enSubtitle', 'zhSubtitle']);
  assert.deepEqual(audit.items[0].local.current.video, []);
  assert.deepEqual(audit.items[0].local.variants.map(file => file.name), [
    'Video 15A Breakouts.mp4',
    'Video 15A Breakouts.en.vtt',
  ]);
  assert.match(audit.items[0].downloads.video.ytDlpCommand, /yt-dlp --referer/);

  assert.deepEqual(audit.items[1].needs, []);
});

test('Brooks media audit matches records whose media title already ends with a video extension', () => {
  const audit = auditBrooksMediaIndex({
    index: {
      records: [
        {
          index: 0,
          output: 'BTC HTT 47C Trading in Trading Ranges.mp4.%(ext)s',
          pageUrl: 'https://example.com/video-47c/',
          m3u8: 'https://cdn.example.com/vid0/video.m3u8',
          en: 'https://cdn.example.com/vid0/captions/EN.vtt',
          cn: 'https://cdn.example.com/vid0/captions/CN.vtt',
          referer: 'https://iframe.example.com/embed/vid0',
        },
      ],
    },
    indexPath: '/tmp/index.json',
    localDir: '/videos',
    localFiles: [
      '/videos/BTC HTT 47C Trading in Trading Ranges.mp4',
      '/videos/BTC HTT 47C Trading in Trading Ranges.mp4.zh.vtt',
    ],
  });

  assert.deepEqual(audit.items[0].needs, ['enSubtitle']);
  assert.deepEqual(audit.items[0].local.current.video.map(file => file.name), [
    'BTC HTT 47C Trading in Trading Ranges.mp4',
  ]);
  assert.deepEqual(audit.items[0].local.current.zhSubtitle.map(file => file.name), [
    'BTC HTT 47C Trading in Trading Ranges.mp4.zh.vtt',
  ]);
});

test('Brooks media audit keeps caption download metadata when only the current video is missing', () => {
  const audit = auditBrooksMediaIndex({
    index: {
      records: [
        {
          index: 0,
          output: 'Video 21B Reversals v4.%(ext)s',
          pageUrl: 'https://example.com/video-21b/',
          m3u8: 'https://cdn.example.com/vid21b/video.m3u8',
          en: 'https://cdn.example.com/vid21b/captions/EN.vtt',
          cn: 'https://cdn.example.com/vid21b/captions/CN.vtt',
          referer: 'https://iframe.example.com/embed/vid21b',
        },
      ],
    },
    indexPath: '/tmp/index.json',
    localDir: '/videos',
    localFiles: [
      '/videos/Video 21B Reversals v4.en.vtt',
      '/videos/Video 21B Reversals v4.zh.vtt',
    ],
  });

  assert.deepEqual(audit.items[0].needs, ['video']);
  assert.deepEqual(Object.keys(audit.downloadPlan[0].downloads).sort(), [
    'enSubtitle',
    'video',
    'zhSubtitle',
  ]);
  assert.equal(
    audit.downloadPlan[0].downloads.enSubtitle.url,
    'https://cdn.example.com/vid21b/captions/EN.vtt',
  );
  assert.equal(
    audit.downloadPlan[0].downloads.zhSubtitle.url,
    'https://cdn.example.com/vid21b/captions/CN.vtt',
  );
});

test('Brooks media audit builds quoted yt-dlp commands', () => {
  assert.equal(
    buildYtDlpCommand({
      referer: 'https://example.com/embed?id=1',
      output: "Video 01 Trader's Test.%(ext)s",
      m3u8: 'https://cdn.example.com/video.m3u8?token=abc',
    }),
    "yt-dlp --referer 'https://example.com/embed?id=1' -N 16 -o 'Video 01 Trader'\\''s Test.%(ext)s' 'https://cdn.example.com/video.m3u8?token=abc'",
  );
});

test('Brooks media audit can import the latest downloaded index before auditing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brooks-audit-latest-test-'));
  try {
    const downloadsDir = join(dir, 'Downloads');
    const reportsDir = join(dir, 'reports');
    const localDir = join(dir, 'videos');
    const outputPath = join(reportsDir, 'brooks-media-audit-2026-06-03T104215Z.json');
    await mkdir(downloadsDir);
    await mkdir(reportsDir);
    await mkdir(localDir);
    await writeFile(join(downloadsDir, 'brooks-media-index-2026-06-03T104215Z.json'), JSON.stringify({
      exportedAt: '2026-06-03T10:42:15.123Z',
      completed: true,
      records: [
        {
          index: 0,
          output: 'Video 01 Terminology.%(ext)s',
          m3u8: 'https://cdn.example.com/video-01/video.m3u8',
          en: 'https://cdn.example.com/video-01/captions/EN.vtt',
          cn: 'https://cdn.example.com/video-01/captions/CN.vtt',
          referer: 'https://iframe.example.com/embed/video-01',
        },
      ],
      failures: [],
    }, null, 2));

    await runCli([
      '--index',
      'latest',
      '--downloads',
      downloadsDir,
      '--reports',
      reportsDir,
      '--local',
      localDir,
      '--output',
      outputPath,
    ]);

    const importedPath = join(reportsDir, 'brooks-media-index-2026-06-03T104215Z.json');
    const audit = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(audit.indexPath, importedPath);
    assert.equal(audit.summary.records, 1);
    await assert.rejects(
      readFile(join(downloadsDir, 'brooks-media-index-2026-06-03T104215Z.json'), 'utf8'),
      /ENOENT/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
