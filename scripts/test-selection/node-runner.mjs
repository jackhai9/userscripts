import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';

/** Node's CLI expands filenames as globs; the programmatic files option is literal. */
export function exactNodeArgs(files, options = {}) {
  return [fileURLToPath(import.meta.url), JSON.stringify({ files, ...options })];
}

async function runExactNodeFiles({ files, execArgv = [], reportFile }) {
  assert.equal(process.env.NODE_TEST_CONTEXT, undefined,
    'The exact-file runner must start outside an existing Node test process');
  assert.ok(Array.isArray(files) && files.length > 0, 'Exact-file execution needs selected test files');
  const paths = files.map(file => resolve(file));
  assert.equal(new Set(paths).size, paths.length, 'Selected Node files must be unique');
  const events = run({ files: paths, execArgv, concurrency: true });
  events.on('test:summary', summary => {
    if (!summary.success) process.exitCode = 1;
  });
  await pipeline(events.compose(spec),
    reportFile === undefined ? process.stdout : createWriteStream(reportFile),
    { end: reportFile !== undefined });
  if (reportFile !== undefined) process.stdout.write('Node test results: ' + reportFile + '\n');
}

if (import.meta.main) await runExactNodeFiles(JSON.parse(process.argv[2]));
