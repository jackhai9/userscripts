import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildLivePerformanceCapture,
} from '../e2e/binance-orderbook/helpers/live-capture-builder.js';

function parseArguments(args) {
  if (args.length !== 2) {
    throw new Error('Usage: node scripts/binance-live-capture.mjs <raw-bundle.json> <capture.json>');
  }
  const inputPath = resolve(args[0]);
  const outputPath = resolve(args[1]);
  if (inputPath === outputPath) throw new Error('input and output paths must differ');
  return { inputPath, outputPath };
}

export async function runLiveCaptureAssemblyCli(args) {
  const { inputPath, outputPath } = parseArguments(args);
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const capture = buildLivePerformanceCapture(input);
  await writeFile(outputPath, `${JSON.stringify(capture, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return Object.freeze({
    inputPath,
    outputPath,
    scenarioCount: capture.scenarios.length,
    sampleCount: capture.scenarios.reduce(
      (total, scenario) => total + scenario.samples.length,
      0,
    ),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLiveCaptureAssemblyCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
