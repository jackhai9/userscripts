import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildBrooksMediaIndexReportName,
  getDefaultBrooksReportsDir,
  importLatestBrooksMediaIndex,
} from '../../scripts/brooks-media-import-index.mjs';

function createIndex(exportedAt = '2026-06-03T10:42:15.123Z') {
  return {
    exportedAt,
    completed: true,
    records: [
      {
        index: 0,
        output: 'Video 01 Terminology.%(ext)s',
        m3u8: 'https://cdn.example.com/video.m3u8',
        en: 'https://cdn.example.com/EN.vtt',
        cn: 'https://cdn.example.com/CN.vtt',
      },
    ],
    failures: [],
  };
}

test('user observes that Brooks media index import builds a flat timestamped report filename', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = createIndex();
  // When the real operation processes that input
  const observed = buildBrooksMediaIndexReportName(scenarioInput);
  // Then Brooks media index import builds a flat timestamped report filename
  assert.equal(
    observed,
    'brooks-media-index-2026-06-03T104215Z.json',
  );
});

test('user observes that Brooks media index import derives the default report directory from the user home', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = '/Users/alice';
  // When the real operation processes that input
  const observed = getDefaultBrooksReportsDir(scenarioInput);
  // Then Brooks media index import derives the default report directory from the user home
  assert.equal(
    observed,
    '/Users/alice/PA/brooks-media-sync/reports',
  );
});

test('user observes that Brooks media index import moves the latest completed export into the flat reports directory', async () => {
  // Given the downloads fixture contains timestamped complete media indexes
  const dir = await mkdtemp(join(tmpdir(), 'brooks-import-test-'));
  try {
    const downloadsDir = join(dir, 'Downloads');
    const reportsDir = join(dir, 'reports');
    await mkdir(downloadsDir);
    await mkdir(reportsDir);
    const oldPath = join(downloadsDir, 'brooks-media-index-2026-06-03.json');
    const latestPath = join(downloadsDir, 'brooks-media-index-2026-06-03 (1).json');
    await writeFile(oldPath, JSON.stringify(createIndex('2026-06-03T09:00:00.000Z'), null, 2));
    await writeFile(latestPath, JSON.stringify(createIndex('2026-06-03T10:42:15.123Z'), null, 2));

    // When the importer resolves the appropriate report destination
    const result = await importLatestBrooksMediaIndex({ downloadsDir, reportsDir });

    // Then Brooks media index import moves the latest completed export into the flat reports directory
    assert.equal(result.status, 'moved');
    assert.equal(result.targetPath, join(reportsDir, 'brooks-media-index-2026-06-03T104215Z.json'));
    assert.equal(
      JSON.parse(await readFile(result.targetPath, 'utf8')).exportedAt,
      '2026-06-03T10:42:15.123Z',
    );
    await assert.rejects(readFile(latestPath, 'utf8'), /ENOENT/);
    assert.equal(
      JSON.parse(await readFile(oldPath, 'utf8')).exportedAt,
      '2026-06-03T09:00:00.000Z',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('user observes that Brooks media index import removes duplicate downloads when the report already exists', async () => {
  // Given the downloads fixture contains timestamped complete media indexes
  const dir = await mkdtemp(join(tmpdir(), 'brooks-import-dedupe-test-'));
  try {
    const downloadsDir = join(dir, 'Downloads');
    const reportsDir = join(dir, 'reports');
    await mkdir(downloadsDir);
    await mkdir(reportsDir);
    const sourcePath = join(downloadsDir, 'brooks-media-index-2026-06-03.json');
    const targetPath = join(reportsDir, 'brooks-media-index-2026-06-03T104215Z.json');
    const content = JSON.stringify(createIndex(), null, 2);
    await writeFile(sourcePath, content);
    await writeFile(targetPath, content);

    // When the importer resolves the appropriate report destination
    const result = await importLatestBrooksMediaIndex({ downloadsDir, reportsDir });

    // Then Brooks media index import removes duplicate downloads when the report already exists
    assert.deepEqual(result, {
      status: 'duplicate',
      sourcePath,
      targetPath,
    });
    await assert.rejects(readFile(sourcePath, 'utf8'), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
