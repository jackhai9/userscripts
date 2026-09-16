import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

import {
  collectProofNodeEntry,
  composeProofBrowserSource,
  createMergeProof,
  mapProofEntries,
  reportProofEntries,
} from '../../../scripts/test-coverage/merge-proof.mjs';
import { splitCoverageEntry } from '../../../scripts/test-coverage/split-entries.mjs';
import {
  startBrowserCoverage,
  checkpointBrowserCoverage,
  stopBrowserCoverage,
} from '../../../scripts/test-coverage/collect-browser.mjs';
import { mergeBrowserSnapshots } from '../../../scripts/test-coverage/browser-snapshots.mjs';

const cases = [
  {
    name: 'a single main bundle',
    copies: [{ artifact: 0, branch: false, calls: 2, executed: true }],
    browserCounts: [0, 2], unsplitCounts: [0, 2], rawFunctionCounts: [2], rootCounts: [1],
  },
  {
    name: 'coexisting bundles that execute the same browser branch',
    copies: [{ artifact: 0, branch: false, calls: 2, executed: true }, { artifact: 1, branch: false, calls: 3, executed: true }],
    browserCounts: [0, 5], unsplitCounts: [0, 2], rawFunctionCounts: [2, 3], rootCounts: [1, 1],
  },
  {
    name: 'coexisting bundles that execute opposite branches',
    copies: [{ artifact: 0, branch: true, calls: 2, executed: true }, { artifact: 1, branch: false, calls: 3, executed: true }],
    browserCounts: [2, 3], unsplitCounts: [2, 0], rawFunctionCounts: [2, 3], rootCounts: [1, 1],
  },
  {
    name: 'two identical artifact copies that execute opposite branches',
    copies: [{ artifact: 0, branch: false, calls: 2, executed: true }, { artifact: 0, branch: true, calls: 3, executed: true }],
    browserCounts: [3, 2], unsplitCounts: [0, 2], rawFunctionCounts: [2, 3], rootCounts: [1, 1],
  },
  {
    name: 'a dormant wrapper beside an executed opposite branch',
    copies: [{ artifact: 0, branch: false, calls: 2, executed: false }, { artifact: 1, branch: true, calls: 3, executed: true }],
    browserCounts: [3, 0], unsplitCounts: [0, 0], rawFunctionCounts: [3], rootCounts: [0, 1],
  },
];

for (const scenario of cases) {
  test(`user gets exact branch union and execution counts from Node plus ${scenario.name}`, async ({ page }, testInfo) => {
    // Given one complete two-branch ESM source executed in an isolated Node child and compiled into browser artifacts
    const proof = await createMergeProof(testInfo.outputPath('merge-proof'));
    const nodeEntry = await collectProofNodeEntry(proof);
    const source = composeProofBrowserSource(proof, scenario.copies);
    await writeFile(resolve(proof.outputDirectory, 'browser-composed.js'), source);
    await page.setContent('<!doctype html><title>Coverage merge contract</title>');

    // When real Chromium executes the configured copies and exposes its precise V8 counters
    await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true });
    let browserCapture;
    let values;
    try {
      await page.addScriptTag({ content: source });
      values = await page.evaluate(() => globalThis.__coverageProofResults);
    } finally {
      browserCapture = await page.coverage.stopJSCoverage();
    }
    const browserEntries = browserCapture.filter((entry) => entry.source === source);
    expect(browserEntries).toHaveLength(1);
    await writeFile(resolve(proof.outputDirectory, 'browser-raw.json'), JSON.stringify(browserEntries, null, 2));
    const splitEntries = splitCoverageEntry(browserEntries[0], proof.registry);
    const nodeMapped = mapProofEntries([nodeEntry], proof, { split: true });
    const browserMapped = mapProofEntries(browserEntries, proof, { split: true });
    const browserUnsplit = mapProofEntries(browserEntries, proof, { split: false });
    const nodeReport = await reportProofEntries(proof, 'node-only', nodeMapped);
    const unsplitReport = await reportProofEntries(proof, 'browser-unsplit-regression', browserUnsplit);
    const browserReport = await reportProofEntries(proof, 'browser-only', browserMapped);
    const mergedReport = await reportProofEntries(proof, 'merged', [...nodeMapped, ...browserMapped]);

    // Then the source appears once, real counters sum across entries, and no dormant wrapper invents execution credit
    const browserCalls = scenario.browserCounts[0] + scenario.browserCounts[1];
    const mergedCounts = [scenario.browserCounts[0] + 1, scenario.browserCounts[1]];
    expect(values).toEqual(scenario.copies.filter((copy) => copy.executed)
      .flatMap((copy) => Array(copy.calls).fill(copy.branch ? 'node' : 'browser')));
    expect(browserEntries[0].functions.filter((fn) => fn.functionName === 'chooseBranch' && fn.ranges[0].count > 0)
      .map((fn) => fn.ranges[0].count).sort((left, right) => left - right)).toEqual(scenario.rawFunctionCounts);
    expect(splitEntries.map((entry) => entry.functions[0].ranges[0].count)).toEqual(scenario.rootCounts);
    expect(nodeReport).toEqual({ sourcePath: proof.sourcePath, branches: { covered: 1, total: 2, counts: [1, 0] },
      functions: [{ name: 'chooseBranch', count: 1 }] });
    // MCR 2.13.0 discards repeated original ranges within one composed entry.
    // This real counterexample keeps that loss visible while verifying the split repair.
    expect(unsplitReport.branches.counts).toEqual(scenario.unsplitCounts);
    expect(browserReport).toEqual({ sourcePath: proof.sourcePath,
      branches: { covered: scenario.browserCounts.filter((count) => count > 0).length, total: 2, counts: scenario.browserCounts },
      functions: [{ name: 'chooseBranch', count: browserCalls }] });
    expect(mergedReport).toEqual({ sourcePath: proof.sourcePath,
      branches: { covered: mergedCounts.filter((count) => count > 0).length, total: 2, counts: mergedCounts },
      functions: [{ name: 'chooseBranch', count: browserCalls + 1 }] });
    const evidencePath = resolve(proof.outputDirectory, 'merge-evidence.json');
    await writeFile(evidencePath, JSON.stringify({ nodeReport, unsplitReport, browserReport, mergedReport }, null, 2));
    await testInfo.attach('coverage-merge-evidence', { path: evidencePath, contentType: 'application/json' });
  });
}

test('user retains a conservative branch report through a real reload without inventing teardown blocks', async ({ page }, testInfo) => {
  // Given the real collector sees two left-branch calls in each document and three right-branch calls only during teardown.
  const proof = await createMergeProof(testInfo.outputPath('reload-proof'));
  const source = proof.registry.artifacts[0].code
    + '\nCoverageProofMain(true); CoverageProofMain(true);\n'
    + "addEventListener('pagehide', () => { CoverageProofMain(false); CoverageProofMain(false); CoverageProofMain(false); });\n";
  const url = 'https://coverage-proof.test/probe.js';
  await page.route('https://coverage-proof.test/**', route => route.fulfill({
    contentType: route.request().url() === url ? 'application/javascript' : 'text/html',
    body: route.request().url() === url ? source : '<!doctype html><script src="/probe.js"></script>',
  }));
  await startBrowserCoverage(page);
  await page.goto('https://coverage-proof.test/');
  await checkpointBrowserCoverage(page, 'before-reload');

  // When Chromium actually reloads and the collector captures the outgoing and incoming documents.
  await page.reload();
  const raw = await stopBrowserCoverage(page);
  raw.snapshots = raw.snapshots.map(snapshot => ({ ...snapshot,
    entries: snapshot.entries.filter(entry => entry.url === url),
  }));
  await writeFile(resolve(proof.outputDirectory, 'raw-snapshots.json'), JSON.stringify(raw, null, 2));
  const original = structuredClone(raw);
  const merged = mergeBrowserSnapshots(raw);
  const mapped = mapProofEntries(merged.entries, proof, { split: true });
  const report = await reportProofEntries(proof, 'conservative-reload', mapped);

  // Then each real script root is one, detailed left calls total four, and the three coarse right calls receive no branch credit.
  expect(raw).toEqual(original);
  expect(new Set(merged.entries.map(entry => entry.scriptId)).size).toBe(2);
  expect(merged.entries.map(entry => splitCoverageEntry(entry, proof.registry)[0].functions[0].ranges[0].count)).toEqual([1, 1]);
  expect(report).toEqual({ sourcePath: proof.sourcePath,
    branches: { covered: 1, total: 2, counts: [4, 0] }, functions: [{ name: 'chooseBranch', count: 4 }] });
  expect(merged.blockEvidenceUnavailable.filter(item => item.functionName === 'chooseBranch')
    .map(item => ({ count: item.range.count, phase: item.phase, snapshotIndex: item.snapshotIndex })))
    .toEqual([{ count: 3, phase: 'finish', snapshotIndex: 1 }]);
  await writeFile(resolve(proof.outputDirectory, 'reload-evidence.json'), JSON.stringify({ report,
    metricInterpretation: 'retained-evidence-lower-bound', blockEvidenceUnavailable: merged.blockEvidenceUnavailable,
  }, null, 2));
});

test('user gets exact opposite-branch counts across ordinary browser checkpoints', async ({ page }, testInfo) => {
  // Given one complete compiled source remains in the same document throughout both intervals.
  const proof = await createMergeProof(testInfo.outputPath('checkpoint-proof'));
  const source = proof.registry.artifacts[0].code;
  await page.setContent('<!doctype html><title>Incremental coverage</title>');
  await startBrowserCoverage(page);
  await page.addScriptTag({ content: source });
  await page.evaluate(() => { window.CoverageProofMain(true); window.CoverageProofMain(true); });
  await checkpointBrowserCoverage(page, 'first-calls');

  // When the opposite branch runs three times after counters were reset by a checkpoint.
  await page.evaluate(() => {
    window.CoverageProofMain(false); window.CoverageProofMain(false); window.CoverageProofMain(false);
  });
  const raw = await stopBrowserCoverage(page);
  raw.snapshots = raw.snapshots.map(snapshot => ({ ...snapshot,
    entries: snapshot.entries.filter(entry => entry.source === source),
  }));
  const merged = mergeBrowserSnapshots(raw);
  const report = await reportProofEntries(proof, 'merged-checkpoints', mapProofEntries(merged.entries, proof, { split: true }));

  // Then counters sum to five and both branches are proven without any coarse or duplicate execution credit.
  expect(merged.entries).toHaveLength(1);
  expect(merged.blockEvidenceUnavailable).toEqual([]);
  expect(report).toEqual({ sourcePath: proof.sourcePath,
    branches: { covered: 2, total: 2, counts: [2, 3] }, functions: [{ name: 'chooseBranch', count: 5 }] });
});
