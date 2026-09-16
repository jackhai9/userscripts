import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { decode, encode } from '@jridgewell/sourcemap-codec';
import * as esbuild from 'esbuild';
import { TARGETS } from '../build-userscript.mjs';
import { ROOT, productionSourceFiles, relativeSourcePath } from './config.mjs';
import { findArtifactSegments } from './split-entries.mjs';

const parserOptions = { ecmaVersion: 'latest', sourceType: 'module' };

/** A coverage-only compilation must execute exactly the public artifact's bytes. */
export async function createSourceRegistry() {
  const sources = new Map(await Promise.all((await productionSourceFiles()).map(async (path) => (
    [path, await readFile(resolve(ROOT, path), 'utf8')]
  ))));
  const artifacts = [];
  for (const [name, target] of Object.entries(TARGETS)) {
    const entry = resolve(ROOT, target.entry);
    const source = sources.get(target.entry);
    const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];
    assert.ok(metadata, 'Missing metadata for ' + name);
    const outfile = resolve(ROOT, 'test-results/coverage/maps', name + '.js');
    const result = await esbuild.build({
      absWorkingDir: ROOT,
      banner: { js: metadata },
      bundle: true,
      charset: 'utf8',
      format: 'iife',
      legalComments: 'none',
      logOverride: target.logOverride || {},
      minify: false,
      platform: 'browser',
      sourcemap: 'external',
      outfile,
      // Keeping the metadata in stdin preserves the original source positions.
      stdin: { contents: source, loader: 'js', resolveDir: dirname(entry), sourcefile: entry },
      target: ['es2020'],
      write: false,
    });
    const code = result.outputFiles.find((file) => file.path.endsWith('.js')).text;
    const map = JSON.parse(result.outputFiles.find((file) => file.path.endsWith('.map')).text);
    assert.equal(code, await readFile(resolve(ROOT, target.output), 'utf8'),
      'Coverage build differs from the public artifact; rebuild ' + name);
    map.sources = map.sources.map((path, index) => {
      const normalized = relativeSourcePath(resolve(dirname(outfile), path));
      assert.equal(map.sourcesContent[index], sources.get(normalized),
        'Coverage source content differs from ' + normalized);
      return normalized;
    });
    const body = parse(code, parserOptions).body;
    artifacts.push({ path: target.output, code, map, body });
  }
  for (const [path, code] of sources) {
    if (!path.startsWith('scripts/')) continue;
    artifacts.push({
      path,
      code,
      map: {
        version: 3, sources: [path], sourcesContent: [code], names: [],
        mappings: encode(code.split('\n').map((_, line) => [[0, 0, line, 0]])),
      },
      body: parse(code, parserOptions).body,
    });
  }
  return { sources, artifacts };
}

/** Compose exact script segments without moving any executed byte or V8 range. */
export function composeSourceMap(source, segments) {
  const sources = [];
  const sourcesContent = [];
  const sourceIndexes = new Map();
  const names = [];
  const nameIndexes = new Map();
  const mappings = Array.from({ length: source.split('\n').length }, () => []);
  for (const { offset, artifact } of segments) {
    const prefix = source.slice(0, offset);
    const lineOffset = prefix.split('\n').length - 1;
    const columnOffset = prefix.length - prefix.lastIndexOf('\n') - 1;
    const sourceRemap = artifact.map.sources.map((path, index) => {
      if (!sourceIndexes.has(path)) {
        sourceIndexes.set(path, sources.length);
        sources.push(path);
        sourcesContent.push(artifact.map.sourcesContent[index]);
      } else {
        assert.equal(sourcesContent[sourceIndexes.get(path)], artifact.map.sourcesContent[index]);
      }
      return sourceIndexes.get(path);
    });
    const nameRemap = artifact.map.names.map((name) => {
      if (!nameIndexes.has(name)) {
        nameIndexes.set(name, names.length);
        names.push(name);
      }
      return nameIndexes.get(name);
    });
    decode(artifact.map.mappings).forEach((line, lineIndex) => {
      for (const segment of line) {
        const mapped = [segment[0] + (lineIndex === 0 ? columnOffset : 0)];
        if (segment.length > 1) mapped.push(sourceRemap[segment[1]], segment[2], segment[3]);
        if (segment.length > 4) mapped.push(nameRemap[segment[4]]);
        mappings[lineOffset + lineIndex].push(mapped);
      }
    });
  }
  for (const line of mappings) line.sort((left, right) => left[0] - right[0]);
  return { version: 3, sources, sourcesContent, names, mappings: encode(mappings) };
}

/** Partial source snippets and quoted bundle text are never credited to a file. */
export function mapCoverageEntry(entry, registry) {
  assert.equal(typeof entry.source, 'string', 'Coverage entries require the actual executed source');
  const namedPath = relativeSourcePath(entry.url);
  if (registry.sources.get(namedPath) === entry.source) {
    return { ...entry, url: pathToFileURL(resolve(ROOT, namedPath)).href };
  }
  const exact = [...registry.sources].filter(([, source]) => source === entry.source);
  if (exact.length === 1) {
    return { ...entry, url: pathToFileURL(resolve(ROOT, exact[0][0])).href };
  }
  const segments = findArtifactSegments(entry.source, registry.artifacts);
  if (!segments.length) return null;
  const hash = createHash('sha256').update(entry.source).digest('hex');
  const sourceMap = composeSourceMap(entry.source, segments);
  // Absolute originals keep Node, anonymous VM, and browser bundles on one identity.
  sourceMap.sources = sourceMap.sources.map((path) => resolve(ROOT, path));
  return {
    ...entry,
    url: pathToFileURL(resolve(ROOT, 'test-results/coverage/virtual', hash + '.js')).href,
    sourceMap,
  };
}
