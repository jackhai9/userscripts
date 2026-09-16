import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, productionSourceFiles, relativeSourcePath } from './config.mjs';

let originals;

async function originalSources() {
  originals ??= productionSourceFiles().then(async (paths) => new Set(
    await Promise.all(paths.map((path) => readFile(resolve(ROOT, path), 'utf8'))),
  ));
  return originals;
}

export async function startBrowserCoverage(page) {
  await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true });
}

export async function finishBrowserCoverage(page, outputDirectory, testInfo) {
  const sources = await originalSources();
  const entries = (await page.coverage.stopJSCoverage()).filter((entry) => (
    typeof entry.source === 'string'
    && (entry.source.includes('// ==UserScript==') || sources.has(entry.source))
  ));
  await writeFile(resolve(outputDirectory, randomUUID() + '.json'), JSON.stringify({
    testId: testInfo.testId,
    testFile: relativeSourcePath(testInfo.file),
    entries,
  }));
}
