import { Session } from 'node:inspector/promises';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isProductionSource, relativeSourcePath } from './config.mjs';

const outputDirectory = process.env.USERSCRIPTS_NODE_COVERAGE_DIRECTORY;
if (!outputDirectory) throw new Error('Node coverage requires an explicit output directory');
const session = new Session();
session.connect();
await session.post('Debugger.enable');
await session.post('Profiler.enable');
await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });

async function collect() {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  const entries = [];
  for (const entry of result) {
    const direct = isProductionSource(entry.url);
    const candidate = direct || !entry.url || entry.url === 'evalmachine.<anonymous>'
      || entry.url.startsWith('https://www.binance.com/')
      || /\/scripts\/[^/]+\.user\.js$/.test(entry.url);
    if (!candidate) continue;
    const { scriptSource: source } = await session.post('Debugger.getScriptSource', { scriptId: entry.scriptId });
    if (direct || source.includes('// ==UserScript==')) entries.push({ ...entry, source });
  }
  const testFile = typeof process.argv[1] === 'string' ? relativeSourcePath(process.argv[1]) : null;
  await writeFile(resolve(outputDirectory, process.pid + '.json'), JSON.stringify({ testFile, entries }));
  await session.post('Profiler.stopPreciseCoverage');
  session.disconnect();
}

process.once('beforeExit', () => {
  collect().catch((error) => {
    // A collector failure invalidates this test run instead of producing a partial green report.
    process.exitCode = 1;
    process.stderr.write('Coverage collection failed: ' + error.message + '\n');
    session.disconnect();
  });
});
