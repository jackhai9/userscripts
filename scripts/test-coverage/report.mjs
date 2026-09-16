import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CoverageReport } from 'monocart-coverage-reports';
import { BRANCH_TARGET, ROOT, isProductionSource, productionSourceFiles } from './config.mjs';
import { createSourceRegistry, mapCoverageEntry } from './source-maps.mjs';
import { verifyCaptures } from './capture-contract.mjs';
import { splitCoverageEntry } from './split-entries.mjs';

export async function buildCoverageReport({ nodeDirectory, browserDirectory, outputDirectory, expectedNodeTests }) {
  const registry = await createSourceRegistry();
  const report = new CoverageReport({
    name: 'Userscripts source coverage',
    baseDir: ROOT,
    outputDir: outputDirectory,
    reports: ['v8', 'console-summary'],
    all: { dir: [resolve(ROOT, 'src'), resolve(ROOT, 'scripts')], filter: isProductionSource },
    sourceFilter: isProductionSource,
    v8Ignore: false,
  });
  const capturedTests = new Set();
  const capturedBrowserTests = new Set();
  const browserManifest = browserDirectory === null ? null
    : JSON.parse(await readFile(resolve(browserDirectory, 'manifest.json'), 'utf8'));
  const unmapped = [];
  const counts = { node: 0, browser: 0 };
  for (const [layer, directory] of [['node', nodeDirectory], ['browser', browserDirectory]]) {
    if (directory === null) continue;
    const files = (await readdir(directory)).filter((path) => path.endsWith('.json') && path !== 'manifest.json').sort();
    assert.ok(files.length > 0, 'Missing ' + layer + ' coverage captures');
    for (const path of files) {
      const capture = JSON.parse(await readFile(resolve(directory, path), 'utf8'));
      const entries = capture.entries;
      if (layer === 'node') capturedTests.add(capture.testFile);
      else {
        assert.equal(capturedBrowserTests.has(capture.testId), false, 'Duplicate browser capture');
        capturedBrowserTests.add(capture.testId);
      }
      const mapped = [];
      for (const entry of entries.flatMap((raw) => splitCoverageEntry(raw, registry))) {
        const result = mapCoverageEntry(entry, registry);
        if (result) mapped.push(result);
        else unmapped.push({ layer, url: entry.url, reason: 'Executed source is not an exact production source or artifact segment' });
      }
      if (mapped.length) {
        await report.add(mapped);
        counts[layer] += mapped.length;
      }
    }
  }
  const tested = verifyCaptures({ expectedNodeTests, capturedNodeTests: capturedTests, browserManifest, capturedBrowserTests });
  assert.ok(counts.node > 0, 'No Node production coverage was collected');
  if (browserDirectory !== null) assert.ok(counts.browser > 0, 'No browser production coverage was collected');
  const result = await report.generate();
  assert.ok(result, 'Coverage reporting produced no result');
  const scope = await productionSourceFiles();
  assert.deepEqual(result.files.map((file) => file.sourcePath).sort(), scope,
    'Coverage must contain every production source exactly once, including unexecuted files');
  const summary = {
    schemaVersion: 1,
    nodeVersion: process.versions.node,
    layers: browserDirectory === null ? ['node'] : ['node', 'browser'],
    targetBranches: BRANCH_TARGET,
    meetsBranchTarget: result.summary.branches.covered * 100 >= BRANCH_TARGET * result.summary.branches.total,
    summary: result.summary,
    scope,
    files: result.files.map((file) => ({
      path: file.sourcePath,
      sha256: createHash('sha256').update(registry.sources.get(file.sourcePath)).digest('hex'),
      summary: file.summary,
    })),
    capturedEntries: counts,
    tests: tested,
    unmapped,
  };
  await writeFile(resolve(outputDirectory, 'coverage-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return { summary, reportPath: resolve(outputDirectory, 'index.html') };
}
