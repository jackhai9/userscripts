import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  verifyStage3EvidenceAgainstSources,
} from '../e2e/binance-orderbook/helpers/stage3-evidence.js';
import { parseTampermonkeyMcpReadback } from './userscript-release-contract.mjs';

function parseArguments(args) {
  if (args.length !== 4) {
    throw new Error('Usage: node scripts/binance-stage3-evidence.mjs <artifact> <mcp-readback> <cdp-loaded-source> <evidence>');
  }
  return {
    artifact: resolve(args[0]),
    readback: resolve(args[1]),
    loadedSource: resolve(args[2]),
    evidence: resolve(args[3]),
  };
}

export async function runStage3EvidenceVerification(args) {
  const paths = parseArguments(args);
  const [artifactSource, readbackText, loadedSource, evidenceText] = await Promise.all([
    readFile(paths.artifact, 'utf8'),
    readFile(paths.readback, 'utf8'),
    readFile(paths.loadedSource, 'utf8'),
    readFile(paths.evidence, 'utf8'),
  ]);
  const installedSource = parseTampermonkeyMcpReadback(readbackText).source;
  const evidence = JSON.parse(evidenceText);
  verifyStage3EvidenceAgainstSources(evidence, {
    artifactSource,
    installedSource,
    loadedSource,
  });
  return Object.freeze({
    verified: true,
    evidence: paths.evidence,
    artifactSha256: evidence.artifact.sha256,
    userscriptVersion: evidence.artifact.version,
    pageUrl: evidence.browser.pageUrl,
    reversibleInteraction: evidence.interaction.name,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runStage3EvidenceVerification(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
