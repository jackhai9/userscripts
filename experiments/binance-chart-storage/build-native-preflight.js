import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const entry = resolve(directory, 'native-preflight-entry.user.js');
const output = resolve(directory, 'native-preflight.user.js');

/** Keep the review artifact self-contained and prove its complete dependency boundary. */
export async function compileNativePreflight() {
  const source = await readFile(entry, 'utf8');
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];
  assert(metadata, 'Native preflight metadata is required');
  const result = await build({
    absWorkingDir: root,
    banner: { js: metadata },
    bundle: true,
    charset: 'utf8',
    format: 'iife',
    legalComments: 'none',
    minify: false,
    platform: 'browser',
    sourcemap: false,
    target: ['es2020'],
    metafile: true,
    stdin: {
      contents: source.replace(metadata, '').trimStart(), loader: 'js',
      resolveDir: directory, sourcefile: entry,
    },
    write: false,
  });
  const inputs = Object.keys(result.metafile.inputs).sort();
  assert.deepEqual(inputs, [
    'experiments/binance-chart-storage/bootstrap.js',
    'experiments/binance-chart-storage/mirror-module.js',
    'experiments/binance-chart-storage/native-preflight-core.js',
    'experiments/binance-chart-storage/native-preflight-entry.user.js',
  ], 'Native preflight must not include a writer or runtime loader');
  assert.equal(result.outputFiles.length, 1, 'Native preflight must be one static script');
  return { code: result.outputFiles[0].text, inputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code } = await compileNativePreflight();
  await writeFile(output, code);
}
