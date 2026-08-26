import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const METADATA_START = '// ==UserScript==';
const METADATA_END = '// ==/UserScript==';

export function parseUserscriptMetadata(source) {
  if (!source.startsWith(`${METADATA_START}\n`)) {
    throw new Error('Userscript metadata must start at the first byte');
  }

  const endIndex = source.indexOf(`\n${METADATA_END}`);
  if (endIndex === -1) {
    throw new Error('Userscript metadata block is not closed');
  }

  const metadata = new Map();
  const lines = source.slice(METADATA_START.length + 1, endIndex).split('\n');
  for (const line of lines) {
    const match = line.match(/^\/\/ @([\w-]+)\s+(.+)$/);
    if (!match) continue;
    const [, key, value] = match;
    const values = metadata.get(key) || [];
    values.push(value.trim());
    metadata.set(key, values);
  }
  return metadata;
}

function requireSingleMetadata(metadata, key) {
  const values = metadata.get(key) || [];
  if (values.length !== 1) {
    throw new Error(`Expected exactly one @${key}, found ${values.length}`);
  }
  return values[0];
}

export function createUserscriptReleaseContract(source, artifactPath) {
  const metadata = parseUserscriptMetadata(source);
  const version = requireSingleMetadata(metadata, 'version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid semantic userscript version: ${version}`);
  }

  const matches = metadata.get('match') || [];
  if (matches.length === 0) {
    throw new Error('Expected at least one @match');
  }

  return Object.freeze({
    artifact: artifactPath,
    name: requireSingleMetadata(metadata, 'name'),
    namespace: requireSingleMetadata(metadata, 'namespace'),
    version,
    runAt: requireSingleMetadata(metadata, 'run-at'),
    updateURL: requireSingleMetadata(metadata, 'updateURL'),
    downloadURL: requireSingleMetadata(metadata, 'downloadURL'),
    matches,
    sha256: createHash('sha256').update(source).digest('hex'),
    bytes: Buffer.byteLength(source),
    characters: source.length,
  });
}

export function compareUserscriptSources(expectedSource, actualSource) {
  const expected = createUserscriptReleaseContract(expectedSource, 'expected');
  const actual = createUserscriptReleaseContract(actualSource, 'actual');
  return Object.freeze({
    exactSourceMatch: expectedSource === actualSource,
    expected,
    actual,
  });
}

export function parseTampermonkeyMcpReadback(readback) {
  if (readback.trimStart().startsWith('{')) {
    const payload = JSON.parse(readback);
    if (typeof payload.value !== 'string') {
      throw new Error('Tampermonkey MCP JSON read-back is missing the source value');
    }
    return Object.freeze({
      source: payload.value,
      lastModified: payload.lastModified ?? null,
    });
  }

  const footerMatch = readback.match(/\n\n---\nLast modified: ([^\n]+)$/);
  if (!footerMatch) {
    throw new Error('Tampermonkey MCP text read-back is missing its transport footer');
  }
  const lastModified = footerMatch[1];
  if (Number.isNaN(Date.parse(lastModified))) {
    throw new Error(`Invalid Tampermonkey MCP modification time: ${lastModified}`);
  }
  return Object.freeze({
    source: readback.slice(0, footerMatch.index),
    lastModified,
  });
}

function parseArguments(args) {
  if (args.length === 0 || args.length > 3) {
    throw new Error('Usage: node scripts/userscript-release-contract.mjs <artifact> [--compare|--compare-mcp-readback <installed-source>]');
  }
  const comparisonMode = args[1] || null;
  if (args.length > 1 && (args.length !== 3 || !['--compare', '--compare-mcp-readback'].includes(comparisonMode))) {
    throw new Error('Expected --compare or --compare-mcp-readback followed by an installed-source path');
  }
  return { artifact: args[0], comparison: args[2] || null, comparisonMode };
}

export async function runUserscriptReleaseContract(args) {
  const { artifact, comparison, comparisonMode } = parseArguments(args);
  const artifactPath = resolve(artifact);
  const source = await readFile(artifactPath, 'utf8');
  if (!comparison) {
    return createUserscriptReleaseContract(source, artifactPath);
  }

  const comparisonPath = resolve(comparison);
  const comparisonText = await readFile(comparisonPath, 'utf8');
  const installedSource = comparisonMode === '--compare-mcp-readback'
    ? parseTampermonkeyMcpReadback(comparisonText).source
    : comparisonText;
  const result = compareUserscriptSources(source, installedSource);
  if (!result.exactSourceMatch) {
    throw new Error(
      `Installed source mismatch: expected ${result.expected.sha256}, received ${result.actual.sha256}`,
    );
  }
  return Object.freeze({ ...result, installedSource: comparisonPath });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runUserscriptReleaseContract(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
