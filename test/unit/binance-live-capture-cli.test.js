import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runLiveCaptureAssemblyCli } from '../../scripts/binance-live-capture.mjs';

function probeSnapshot(firstFeedbackMs) {
  return {
    schemaVersion: 1,
    sessionId: `probe-${firstFeedbackMs}`,
    scenarioName: 'cancel-current-symbol-no-orders',
    capturedAt: '2026-08-27T01:00:00.000Z',
    timeOriginMs: 1000,
    armedAtMonotonicMs: 10,
    startedAtMonotonicMs: 20,
    startedAtWallClock: '2026-08-27T01:00:00.010Z',
    finishedAtMonotonicMs: 120,
    performanceSupport: { longTask: true, longAnimationFrame: true },
    dropped: { events: 0, errors: 0, longTasks: 0, longAnimationFrames: 0 },
    events: [
      { kind: 'cancel-click', atMs: 0, detail: null },
      { kind: 'first-feedback', atMs: firstFeedbackMs, detail: null },
      { kind: 'finished', atMs: 100, detail: null },
    ],
    errors: [],
    longTasks: [],
    longAnimationFrames: [],
    clickSemanticSignature: '{}',
    lastSemanticSignature: '{}',
    lastSemanticState: {},
    firstFeedbackCaptured: true,
  };
}

function rawBundle() {
  return {
    capturedAt: '2026-08-27T01:00:00.000Z',
    environment: {
      browser: 'Chrome 151.0.0.0',
      os: 'macOS (MacIntel)',
      route: 'https://www.binance.com/zh-CN/futures/HYPEUSDT',
      symbol: 'HYPEUSDT',
      userscriptSha256: 'a'.repeat(64),
      userscriptVersion: '2.7.126',
    },
    scenarios: [{
      name: 'cancel-current-symbol-no-orders',
      parameters: { kind: 'no-orders' },
      samples: [3, 4, 5].map((firstFeedbackMs) => ({
        probe: probeSnapshot(firstFeedbackMs),
        capacityEvidence: null,
        testOrderLedger: { created: [], fills: [], residual: [] },
        stateRestored: true,
      })),
    }],
  };
}

test('user assembles a strict capture file from a raw probe bundle', async (context) => {
  // Given the local capture fixture contains a raw probe bundle
  const directory = await mkdtemp(join(tmpdir(), 'binance-live-capture-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'raw-bundle.json');
  const outputPath = join(directory, 'capture.json');
  await writeFile(inputPath, `${JSON.stringify(rawBundle(), null, 2)}\n`);

  const result = await runLiveCaptureAssemblyCli([inputPath, outputPath]);
  // When the assembly CLI processes the supplied paths
  const capture = JSON.parse(await readFile(outputPath, 'utf8'));

  // Then CLI assembles a strict capture file from a raw probe bundle
  assert.equal(result.outputPath, outputPath);
  assert.equal(result.scenarioCount, 1);
  assert.equal(result.sampleCount, 3);
  assert.deepEqual(capture.scenarios[0].samples[0].segmentsMs, {
    clickToFirstFeedback: 3,
    clickToFinalReady: 100,
  });
});

test('user refuses to overwrite its raw input bundle', async () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = ['/tmp/live-bundle.json', '/tmp/live-bundle.json'];
  // When the real operation processes that input
  const observed = runLiveCaptureAssemblyCli(scenarioInput);
  // Then CLI refuses to overwrite its raw input bundle
  await assert.rejects(
    observed,
    /input and output paths must differ/,
  );
});

test('user preserves an existing capture instead of overwriting evidence', async (context) => {
  // Given the local capture fixture contains a raw probe bundle
  const directory = await mkdtemp(join(tmpdir(), 'binance-live-capture-existing-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, 'raw-bundle.json');
  const outputPath = join(directory, 'capture.json');
  // When the assembly CLI processes the supplied paths
  await Promise.all([
    writeFile(inputPath, `${JSON.stringify(rawBundle(), null, 2)}\n`),
    writeFile(outputPath, 'existing evidence\n'),
  ]);

  // Then CLI preserves an existing capture instead of overwriting evidence
  await assert.rejects(
    runLiveCaptureAssemblyCli([inputPath, outputPath]),
    (error) => error.code === 'EEXIST',
  );
  assert.equal(await readFile(outputPath, 'utf8'), 'existing evidence\n');
});
