import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TARGETS = {
  'binance-orderbook-trade': {
    entry: 'src/binance-orderbook-trade/index.user.js',
    output: 'scripts/binance-orderbook-trade.user.js',
  },
  'binance-trading-data': {
    entry: 'src/binance-trading-data/index.user.js',
    output: 'scripts/binance-trading-data.user.js',
  },
  'binance-coinmarketcap-data': {
    entry: 'src/binance-coinmarketcap-data/index.user.js',
    output: 'scripts/binance-coinmarketcap-data.user.js',
  },
  'm3u8-downloader': {
    entry: 'src/m3u8-downloader/index.user.js',
    output: 'scripts/m3u8-downloader.user.js',
    // The legacy injected downloader still evaluates fetched UI code; keep the bundle warning local to this target.
    logOverride: {
      'direct-eval': 'silent',
    },
  },
};

async function buildTarget(name) {
  const target = TARGETS[name];
  if (!target) {
    throw new Error(`Unknown userscript build target: ${name}`);
  }

  const entry = resolve(root, target.entry);
  const output = resolve(root, target.output);
  const source = await readFile(entry, 'utf8');
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)?.[0];

  if (!metadata) {
    throw new Error(`Missing userscript metadata block in ${entry}`);
  }

  if (target.copy) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, source.endsWith('\n') ? source : `${source}\n`);
    return;
  }

  const sourceWithoutMetadata = source.replace(metadata, '').trimStart();
  const result = await esbuild.build({
    absWorkingDir: root,
    banner: { js: metadata },
    bundle: true,
    charset: 'utf8',
    format: 'iife',
    legalComments: 'none',
    logOverride: target.logOverride || {},
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
    throw new Error(`esbuild did not produce a userscript bundle for ${name}`);
  }

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bundled.endsWith('\n') ? bundled : `${bundled}\n`);
}

export async function buildUserscripts(names) {
  const targetNames = names.length > 0 ? names : Object.keys(TARGETS);
  for (const name of targetNames) {
    await buildTarget(name);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildUserscripts(process.argv.slice(2));
}
