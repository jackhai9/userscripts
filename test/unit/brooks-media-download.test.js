import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertValidVtt,
  archiveBrooksOldVariantFiles,
  buildBrooksMediaDownloadTasks,
  preflightBrooksOldVariantArchiveTasks,
  downloadBrooksVideoTask,
  getYtDlpAvailability,
  downloadBrooksMediaTask,
} from '../../scripts/brooks-media-download.mjs';

function createAudit() {
  return {
    localDir: '/videos',
    downloadPlan: [
      {
        index: 0,
        base: 'Video 01 Terminology',
        needs: ['zhSubtitle'],
        downloads: {
          zhSubtitle: {
            url: 'https://cdn.example.com/video-01/captions/CN.vtt',
            output: 'Video 01 Terminology.zh.vtt',
          },
        },
      },
      {
        index: 1,
        base: 'Video 02A Chart Basics',
        needs: ['enSubtitle', 'zhSubtitle'],
        downloads: {
          enSubtitle: {
            url: 'https://cdn.example.com/video-02a/captions/EN.vtt',
            output: 'Video 02A Chart Basics.en.vtt',
          },
          zhSubtitle: {
            url: 'https://cdn.example.com/video-02a/captions/CN.vtt',
            output: 'Video 02A Chart Basics.zh.vtt',
          },
        },
      },
      {
        index: 2,
        base: 'Video 03A Forex Basics',
        needs: ['video'],
        downloads: {
          video: {
            m3u8: 'https://cdn.example.com/video-03a/video.m3u8',
            referer: 'https://iframe.example.com/embed/video-03a',
            output: 'Video 03A Forex Basics.%(ext)s',
            ytDlpCommand: "yt-dlp --referer 'https://iframe.example.com/embed/video-03a' -N 16 -o 'Video 03A Forex Basics.%(ext)s' 'https://cdn.example.com/video-03a/video.m3u8'",
          },
          enSubtitle: {
            url: 'https://cdn.example.com/video-03a/captions/EN.vtt',
            output: 'Video 03A Forex Basics.en.vtt',
          },
          zhSubtitle: {
            url: 'https://cdn.example.com/video-03a/captions/CN.vtt',
            output: 'Video 03A Forex Basics.zh.vtt',
          },
        },
        local: {
          variants: [
            {
              kind: 'video',
              lang: null,
              name: 'Video 03A Forex Basics.mp4',
              path: '/videos/Video 03A Forex Basics.mp4',
            },
            {
              kind: 'subtitle',
              lang: 'en',
              name: 'Video 03A Forex Basics.en.vtt',
              path: '/videos/Video 03A Forex Basics.en.vtt',
            },
          ],
        },
      },
    ],
    items: [
      {
        index: 2,
        base: 'Video 03A Forex Basics v2',
        local: {
          variants: [
            {
              kind: 'video',
              lang: null,
              name: 'Video 03A Forex Basics.mp4',
              path: '/videos/Video 03A Forex Basics.mp4',
            },
            {
              kind: 'subtitle',
              lang: 'zh',
              name: 'Video 03A Forex Basics.zh.vtt',
              path: '/videos/Video 03A Forex Basics.zh.vtt',
            },
          ],
        },
      },
    ],
  };
}

test('user observes that Brooks media download builds limited Chinese subtitle tasks and skips existing files', () => {
  // Given the supplied input describes this media scenario
  const scenarioInput = {
    audit: createAudit(),
    only: 'zhSubtitle',
    existingNames: new Set(['Video 01 Terminology.zh.vtt']),
    limit: 1,
  };
  // When the Brooks media download builds limited Chinese subtitle tasks and skips existing files
  const tasks = buildBrooksMediaDownloadTasks(scenarioInput);

  // Then Brooks media download builds limited Chinese subtitle tasks and skips existing files
  assert.deepEqual(tasks.map(task => ({
    index: task.index,
    kind: task.kind,
    output: task.output,
    targetPath: task.targetPath,
  })), [
    {
      index: 1,
      kind: 'zhSubtitle',
      output: 'Video 02A Chart Basics.zh.vtt',
      targetPath: '/videos/Video 02A Chart Basics.zh.vtt',
    },
  ]);
});

test('user observes that Brooks media download validates VTT responses before writing final files', async () => {
  // Given the reviewed media plan defines the selected files and download boundary
  const dir = await mkdtemp(join(tmpdir(), 'brooks-download-test-'));
  try {
    const task = buildBrooksMediaDownloadTasks({
      audit: createAudit(),
      only: 'zhSubtitle',
      localDir: dir,
      limit: 1,
    })[0];

    // When the downloader processes the supplied task
    const result = await downloadBrooksMediaTask(task, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => '\uFEFFWEBVTT\n\n00:00:00.000 --> 00:00:01.000\n你好\n',
      }),
    });

    // Then Brooks media download validates VTT responses before writing final files
    assert.equal(result.status, 'downloaded');
    assert.equal(await readFile(join(dir, 'Video 01 Terminology.zh.vtt'), 'utf8'), '\uFEFFWEBVTT\n\n00:00:00.000 --> 00:00:01.000\n你好\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('user observes that Brooks media download classifies missing Chinese captions when English captions exist', async () => {
  // Given the reviewed media plan defines the selected files and download boundary
  const task = buildBrooksMediaDownloadTasks({
    audit: createAudit(),
    only: 'zhSubtitle',
    limit: 1,
  })[0];
  const requestedUrls = [];

  // When the downloader processes the supplied task
  const result = await downloadBrooksMediaTask(task, {
    fetchImpl: async url => {
      requestedUrls.push(url);
      if (url.endsWith('/CN.vtt')) {
        return {
          ok: false,
          status: 404,
          text: async () => 'not found',
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nEnglish\n',
      };
    },
  });

  // Then Brooks media download classifies missing Chinese captions when English captions exist
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'zhSubtitleNotPublished');
  assert.equal(result.httpStatus, 404);
  assert.deepEqual(result.comparison, {
    kind: 'enSubtitle',
    status: 200,
  });
  assert.deepEqual(requestedUrls, [
    'https://cdn.example.com/video-01/captions/CN.vtt',
    'https://cdn.example.com/video-01/captions/EN.vtt',
  ]);
});

test('user observes that Brooks media download rejects non-VTT error pages', () => {
  // Given the rejected input preserves the specific invalid condition
  const scenarioInput = 'Video 01 Terminology.zh.vtt';
  let failure;
  // When the real operation evaluates the rejected input
  try {
    assertValidVtt('<html><body>403 Forbidden</body></html>', scenarioInput);
  } catch (error) {
    failure = error;
  }
  // Then Brooks media download rejects non-VTT error pages
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /not a VTT file/);
});

test('user observes that Brooks media download builds video tasks for yt-dlp dry runs', () => {
  // Given the supplied input describes this media scenario
  const scenarioInput = {
    audit: createAudit(),
    only: 'video',
    existingNames: new Set(),
  };
  // When the Brooks media download builds video tasks for yt-dlp dry runs
  const tasks = buildBrooksMediaDownloadTasks(scenarioInput);

  // Then Brooks media download builds video tasks for yt-dlp dry runs
  assert.deepEqual(tasks.map(task => ({
    index: task.index,
    kind: task.kind,
    output: task.output,
    targetPath: task.targetPath,
    ytDlpArgs: task.ytDlpArgs,
    ytDlpCommand: task.ytDlpCommand,
  })), [
    {
      index: 2,
      kind: 'video',
      output: 'Video 03A Forex Basics.%(ext)s',
      targetPath: '/videos/Video 03A Forex Basics.%(ext)s',
      ytDlpArgs: [
        '--referer',
        'https://iframe.example.com/embed/video-03a',
        '-N',
        '16',
        '-o',
        '/videos/Video 03A Forex Basics.%(ext)s',
        'https://cdn.example.com/video-03a/video.m3u8',
      ],
      ytDlpCommand: "yt-dlp --referer 'https://iframe.example.com/embed/video-03a' -N 16 -o '/videos/Video 03A Forex Basics.%(ext)s' 'https://cdn.example.com/video-03a/video.m3u8'",
    },
  ]);
});

test('user observes that Brooks media download executes one video task through yt-dlp args', () => {
  // Given the reviewed media plan defines the selected files and download boundary
  const task = buildBrooksMediaDownloadTasks({
    audit: createAudit(),
    only: 'video',
    existingNames: new Set(),
    limit: 1,
  })[0];
  const calls = [];

  // When the downloader processes the supplied task
  const result = downloadBrooksVideoTask(task, {
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  // Then Brooks media download executes one video task through yt-dlp args
  assert.deepEqual(result, {
    status: 'downloaded',
    output: 'Video 03A Forex Basics.%(ext)s',
  });
  assert.deepEqual(calls, [
    {
      command: 'yt-dlp',
      args: task.ytDlpArgs,
      options: { stdio: 'inherit' },
    },
  ]);
});

test('user observes that Brooks media download can attach forced caption refresh tasks to video downloads', () => {
  // Given the supplied input describes this media scenario
  const scenarioInput = {
    audit: createAudit(),
    only: 'video',
    existingNames: new Set([
      'Video 03A Forex Basics.en.vtt',
      'Video 03A Forex Basics.zh.vtt',
    ]),
    refreshCaptionsWithVideo: true,
  };
  // When the Brooks media download can attach forced caption refresh tasks to video downloads
  const tasks = buildBrooksMediaDownloadTasks(scenarioInput);

  // Then Brooks media download can attach forced caption refresh tasks to video downloads
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].captionTasks.map(task => ({
    kind: task.kind,
    output: task.output,
    targetPath: task.targetPath,
    url: task.url,
  })), [
    {
      kind: 'enSubtitle',
      output: 'Video 03A Forex Basics.en.vtt',
      targetPath: '/videos/Video 03A Forex Basics.en.vtt',
      url: 'https://cdn.example.com/video-03a/captions/EN.vtt',
    },
    {
      kind: 'zhSubtitle',
      output: 'Video 03A Forex Basics.zh.vtt',
      targetPath: '/videos/Video 03A Forex Basics.zh.vtt',
      url: 'https://cdn.example.com/video-03a/captions/CN.vtt',
    },
  ]);
});

test('user observes that Brooks media download attaches old variant archive metadata to video tasks', () => {
  // Given the supplied input describes this media scenario
  const scenarioInput = {
    audit: createAudit(),
    only: 'video',
    existingNames: new Set(),
    refreshCaptionsWithVideo: true,
    archiveOldVariantsDir: '/archive',
  };
  // When the Brooks media download attaches old variant archive metadata to video tasks
  const tasks = buildBrooksMediaDownloadTasks(scenarioInput);

  // Then Brooks media download attaches old variant archive metadata to video tasks
  assert.deepEqual(tasks[0].oldVariantFiles, [
    {
      kind: 'video',
      lang: null,
      name: 'Video 03A Forex Basics.mp4',
      sourcePath: '/videos/Video 03A Forex Basics.mp4',
      targetPath: '/archive/videos/Video 03A Forex Basics.mp4',
    },
    {
      kind: 'subtitle',
      lang: 'en',
      name: 'Video 03A Forex Basics.en.vtt',
      sourcePath: '/videos/Video 03A Forex Basics.en.vtt',
      targetPath: '/archive/subtitles-en/Video 03A Forex Basics.en.vtt',
    },
  ]);
});

test('user observes that Brooks media download builds existing old variant archive tasks from audit items', () => {
  // Given the supplied input describes this media scenario
  const scenarioInput = {
    audit: createAudit(),
    only: 'oldVariants',
    archiveOldVariantsDir: '/archive',
  };
  // When the Brooks media download builds existing old variant archive tasks from audit items
  const tasks = buildBrooksMediaDownloadTasks(scenarioInput);

  // Then Brooks media download builds existing old variant archive tasks from audit items
  assert.deepEqual(tasks, [
    {
      index: 2,
      base: 'Video 03A Forex Basics v2',
      kind: 'oldVariants',
      output: 'Video 03A Forex Basics v2',
      oldVariantFiles: [
        {
          kind: 'video',
          lang: null,
          name: 'Video 03A Forex Basics.mp4',
          sourcePath: '/videos/Video 03A Forex Basics.mp4',
          targetPath: '/archive/videos/Video 03A Forex Basics.mp4',
        },
        {
          kind: 'subtitle',
          lang: 'zh',
          name: 'Video 03A Forex Basics.zh.vtt',
          sourcePath: '/videos/Video 03A Forex Basics.zh.vtt',
          targetPath: '/archive/subtitles-zh/Video 03A Forex Basics.zh.vtt',
        },
      ],
    },
  ]);
});

test('user observes that Brooks media download preflights old variant archive batches before moving files', async () => {
  // Given the reviewed media plan defines the selected files and download boundary
  const dir = await mkdtemp(join(tmpdir(), 'brooks-archive-preflight-test-'));
  try {
    const localDir = join(dir, 'local');
    const archiveDir = join(dir, 'archive');
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, 'Video 03A Forex Basics.mp4'), 'old video');
    // When the downloader processes the supplied task
    const tasks = [
      {
        index: 2,
        base: 'Video 03A Forex Basics v2',
        oldVariantFiles: [
          {
            kind: 'video',
            lang: null,
            name: 'Video 03A Forex Basics.mp4',
            sourcePath: join(localDir, 'Video 03A Forex Basics.mp4'),
            targetPath: join(archiveDir, 'videos', 'Video 03A Forex Basics.mp4'),
          },
        ],
      },
    ];

    // Then Brooks media download preflights old variant archive batches before moving files
    assert.deepEqual(await preflightBrooksOldVariantArchiveTasks(tasks), {
      files: 1,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('user observes that Brooks media download rejects duplicate old variant archive targets', async () => {
  // Given the reviewed media plan defines the selected files and download boundary
  const dir = await mkdtemp(join(tmpdir(), 'brooks-archive-duplicate-test-'));
  try {
    const localDir = join(dir, 'local');
    const archiveDir = join(dir, 'archive');
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, 'first.mp4'), 'first');
    await writeFile(join(localDir, 'second.mp4'), 'second');
    const duplicateTarget = join(archiveDir, 'videos', 'same.mp4');
    // When the downloader processes the supplied task
    const tasks = [
      {
        oldVariantFiles: [
          {
            kind: 'video',
            lang: null,
            name: 'first.mp4',
            sourcePath: join(localDir, 'first.mp4'),
            targetPath: duplicateTarget,
          },
        ],
      },
      {
        oldVariantFiles: [
          {
            kind: 'video',
            lang: null,
            name: 'second.mp4',
            sourcePath: join(localDir, 'second.mp4'),
            targetPath: duplicateTarget,
          },
        ],
      },
    ];

    // Then Brooks media download rejects duplicate old variant archive targets
    await assert.rejects(
      preflightBrooksOldVariantArchiveTasks(tasks),
      /Duplicate archive target/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('user observes that Brooks media download archives old variant files without overwriting targets', async () => {
  // Given the reviewed media plan defines the selected files and download boundary
  const dir = await mkdtemp(join(tmpdir(), 'brooks-archive-test-'));
  try {
    const localDir = join(dir, 'local');
    const archiveDir = join(dir, 'archive');
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, 'Video 03A Forex Basics.mp4'), 'old video', { flag: 'wx' });
    await writeFile(join(localDir, 'Video 03A Forex Basics.en.vtt'), 'WEBVTT\nold en\n');
    const task = {
      index: 2,
      base: 'Video 03A Forex Basics v2',
      oldVariantFiles: [
        {
          kind: 'video',
          lang: null,
          name: 'Video 03A Forex Basics.mp4',
          sourcePath: join(localDir, 'Video 03A Forex Basics.mp4'),
          targetPath: join(archiveDir, 'videos', 'Video 03A Forex Basics.mp4'),
        },
        {
          kind: 'subtitle',
          lang: 'en',
          name: 'Video 03A Forex Basics.en.vtt',
          sourcePath: join(localDir, 'Video 03A Forex Basics.en.vtt'),
          targetPath: join(archiveDir, 'subtitles-en', 'Video 03A Forex Basics.en.vtt'),
        },
      ],
    };

    // When the downloader processes the supplied task
    const result = await archiveBrooksOldVariantFiles(task);

    // Then Brooks media download archives old variant files without overwriting targets
    assert.deepEqual(result, {
      status: 'archived',
      count: 2,
      outputs: [
        'Video 03A Forex Basics.mp4',
        'Video 03A Forex Basics.en.vtt',
      ],
    });
    assert.equal(await readFile(join(archiveDir, 'videos', 'Video 03A Forex Basics.mp4'), 'utf8'), 'old video');
    assert.equal(await readFile(join(archiveDir, 'subtitles-en', 'Video 03A Forex Basics.en.vtt'), 'utf8'), 'WEBVTT\nold en\n');
    await assert.rejects(
      readFile(join(localDir, 'Video 03A Forex Basics.mp4'), 'utf8'),
      /ENOENT/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('user observes that Brooks media download detects whether yt-dlp is available', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = {
    commandExists: () => true,
  };
  // When the real operation processes that input
  const observed = getYtDlpAvailability(scenarioInput);
  // Then Brooks media download detects whether yt-dlp is available
  assert.deepEqual(observed, {
    available: true,
    command: 'yt-dlp',
  });
  assert.deepEqual(getYtDlpAvailability({
    commandExists: () => false,
  }), {
    available: false,
    command: 'yt-dlp',
  });
});
