import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import * as esbuild from 'esbuild';
import { CoverageReport } from 'monocart-coverage-reports';

import { ROOT, assertProjectNodeVersion, relativeSourcePath } from './config.mjs';
import { composeSourceMap, mapCoverageEntry } from './source-maps.mjs';
import { findArtifactSegments, splitCoverageEntry } from './split-entries.mjs';

const runFile = promisify(execFile);

export const PROOF_SOURCE = `export function chooseBranch(nodeBranch) {
  if (nodeBranch) {
    return 'node';
  } else {
    return 'browser';
  }
}
`;

/** All synthetic source, raw captures, and reports stay in this test's output. */
export async function createMergeProof(outputDirectory) {
  await assertProjectNodeVersion();
  await mkdir(outputDirectory, { recursive: true });
  const sourceFile = resolve(outputDirectory, 'branch-source.mjs');
  const sourcePath = relativeSourcePath(sourceFile);
  await writeFile(sourceFile, PROOF_SOURCE);
  const sources = new Map([[sourcePath, PROOF_SOURCE]]);
  const artifacts = [];
  for (const globalName of ['CoverageProofMain', 'CoverageProofCompanion']) {
    const entryFile = resolve(outputDirectory, globalName + '-entry.mjs');
    const entrySource = "import { chooseBranch } from './branch-source.mjs';\n"
      + `globalThis.${globalName} = chooseBranch;\n`;
    await writeFile(entryFile, entrySource);
    sources.set(relativeSourcePath(entryFile), entrySource);
    const outfile = resolve(outputDirectory, globalName + '.js');
    const result = await esbuild.build({
      absWorkingDir: ROOT,
      bundle: true,
      charset: 'utf8',
      format: 'iife',
      legalComments: 'none',
      minify: false,
      platform: 'browser',
      sourcemap: 'external',
      outfile,
      stdin: { contents: entrySource, loader: 'js', resolveDir: outputDirectory, sourcefile: entryFile },
      target: ['es2020'],
      write: false,
    });
    const code = result.outputFiles.find((file) => file.path === outfile).text;
    const map = JSON.parse(result.outputFiles.find((file) => file.path.endsWith('.map')).text);
    map.sources = map.sources.map((path, index) => {
      const normalized = relativeSourcePath(resolve(dirname(outfile), path));
      assert.equal(map.sourcesContent[index], sources.get(normalized));
      return normalized;
    });
    await writeFile(outfile, code);
    await writeFile(outfile + '.map', JSON.stringify(map));
    artifacts.push({ globalName, path: relativeSourcePath(outfile), code, map,
      body: parse(code, { ecmaVersion: 'latest', sourceType: 'module' }).body });
  }
  return { outputDirectory, sourceFile, sourcePath, registry: { sources, artifacts } };
}

export function composeProofBrowserSource(proof, copies) {
  const chunks = ['globalThis.__coverageProofResults = [];\n'];
  for (const [index, copy] of copies.entries()) {
    const artifact = proof.registry.artifacts[copy.artifact];
    chunks.push(copy.executed ? '(() => {\n' : `function dormantProofCopy${index}() {\n`);
    chunks.push(artifact.code);
    for (let call = 0; call < copy.calls; call += 1) {
      chunks.push(`globalThis.__coverageProofResults.push(globalThis.${artifact.globalName}(${copy.branch}));\n`);
    }
    chunks.push(copy.executed ? '})();\n' : '}\n');
  }
  const source = chunks.join('');
  const segments = findArtifactSegments(source, proof.registry.artifacts);
  assert.equal(segments.length, copies.length);
  const map = composeSourceMap(source, segments);
  assert.equal(map.sources.filter((path) => path === proof.sourcePath).length, 1);
  assert.equal(map.sourcesContent[map.sources.indexOf(proof.sourcePath)], PROOF_SOURCE);
  return source;
}

/** A child inspector cannot reset an outer Node coverage collector's counters. */
export async function collectProofNodeEntry(proof) {
  const outputFile = resolve(proof.outputDirectory, 'node-raw.json');
  await runFile(process.execPath, [fileURLToPath(import.meta.url), 'collect-node', proof.sourceFile, outputFile], {
    cwd: ROOT,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  const capture = JSON.parse(await readFile(outputFile, 'utf8'));
  assert.equal(capture.result, 'node');
  assert.equal(capture.entry.source, PROOF_SOURCE);
  return capture.entry;
}

async function captureNode(sourceFile, outputFile) {
  const session = new Session();
  session.connect();
  await session.post('Debugger.enable');
  await session.post('Profiler.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  try {
    const sourceUrl = pathToFileURL(sourceFile).href;
    const { chooseBranch } = await import(sourceUrl);
    const result = chooseBranch(true);
    const coverage = await session.post('Profiler.takePreciseCoverage');
    const entries = coverage.result.filter((entry) => entry.url === sourceUrl);
    assert.equal(entries.length, 1, 'The child must capture the complete imported ESM exactly once');
    const { scriptSource: source } = await session.post('Debugger.getScriptSource', { scriptId: entries[0].scriptId });
    assert.equal(source, PROOF_SOURCE);
    await writeFile(outputFile, JSON.stringify({ result, entry: { ...entries[0], source } }, null, 2));
  } finally {
    await session.post('Profiler.stopPreciseCoverage');
    session.disconnect();
  }
}

export function mapProofEntries(entries, proof, { split }) {
  const selected = split ? entries.flatMap((entry) => splitCoverageEntry(entry, proof.registry)) : entries;
  return selected.map((entry) => {
    const mapped = mapCoverageEntry(entry, proof.registry);
    assert.notEqual(mapped, null, 'Every proof entry must map to its complete known original');
    return mapped;
  });
}

export async function reportProofEntries(proof, label, entries) {
  const outputDir = resolve(proof.outputDirectory, label);
  const report = new CoverageReport({
    name: 'Two-engine coverage merge: ' + label,
    baseDir: ROOT,
    outputDir,
    reports: ['v8-json'],
    logging: 'error',
    sourceFilter: (path) => path === proof.sourcePath,
    v8Ignore: false,
  });
  // MCR normalizes ranges in place; each independent report needs its own copy.
  await report.add(structuredClone(entries));
  const result = await report.generate();
  assert.notEqual(result, undefined, 'A coverage proof must produce a report');
  assert.deepEqual(result.files.map((file) => file.sourcePath), [proof.sourcePath]);
  const file = result.files[0];
  assert.equal(file.source, PROOF_SOURCE);
  return {
    sourcePath: file.sourcePath,
    branches: {
      covered: file.summary.branches.covered,
      total: file.summary.branches.total,
      counts: file.data.branches.map((range) => range.count),
    },
    functions: file.data.functions.map(({ name, count }) => ({ name, count })),
  };
}

if (import.meta.main) {
  assert.equal(process.argv[2], 'collect-node');
  assert.equal(process.argv.length, 5);
  await captureNode(process.argv[3], process.argv[4]);
}
