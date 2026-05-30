import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/binance-orderbook-trade/index.user.js');
const output = resolve(root, 'scripts/binance-orderbook-trade.user.js');

const source = await readFile(entry, 'utf8');
const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];

if (!metadata) {
  throw new Error(`Missing userscript metadata block in ${entry}`);
}

const sourceWithoutMetadata = source.replace(metadata, '').trimStart();

const result = await esbuild.build({
  absWorkingDir: root,
  banner: { js: metadata },
  bundle: true,
  charset: 'utf8',
  format: 'iife',
  legalComments: 'none',
  minify: false,
  platform: 'browser',
  sourcemap: false,
  stdin: {
    contents: sourceWithoutMetadata,
    loader: 'js',
    resolveDir: dirname(entry),
    sourcefile: entry,
  },
  target: ['es2020'],
  write: false,
});

const bundled = result.outputFiles[0]?.text;
if (!bundled) {
  throw new Error('esbuild did not produce a userscript bundle');
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, bundled.endsWith('\n') ? bundled : `${bundled}\n`);
