import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertValidVtt,
  buildBrooksMediaDownloadTasks,
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
            output: 'Video 03A Forex Basics.%(ext)s',
          },
        },
      },
    ],
  };
}

test('Brooks media download builds limited Chinese subtitle tasks and skips existing files', () => {
  const tasks = buildBrooksMediaDownloadTasks({
    audit: createAudit(),
    only: 'zhSubtitle',
    existingNames: new Set(['Video 01 Terminology.zh.vtt']),
    limit: 1,
  });

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

test('Brooks media download validates VTT responses before writing final files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brooks-download-test-'));
  try {
    const task = buildBrooksMediaDownloadTasks({
      audit: createAudit(),
      only: 'zhSubtitle',
      localDir: dir,
      limit: 1,
    })[0];

    const result = await downloadBrooksMediaTask(task, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => '\uFEFFWEBVTT\n\n00:00:00.000 --> 00:00:01.000\n你好\n',
      }),
    });

    assert.equal(result.status, 'downloaded');
    assert.equal(await readFile(join(dir, 'Video 01 Terminology.zh.vtt'), 'utf8'), '\uFEFFWEBVTT\n\n00:00:00.000 --> 00:00:01.000\n你好\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Brooks media download rejects non-VTT error pages', () => {
  assert.throws(
    () => assertValidVtt('<html><body>403 Forbidden</body></html>', 'Video 01 Terminology.zh.vtt'),
    /not a VTT file/,
  );
});
