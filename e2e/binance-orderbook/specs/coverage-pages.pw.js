import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

import {
  checkpointBrowserCoverage,
  coverContextPages,
} from '../../../scripts/test-coverage/collect-browser.mjs';

const ORIGIN = 'https://coverage-pages.test';
const PROBE = '// ==UserScript==\n// @name Coverage pages probe\n// ==/UserScript==\n'
  + 'globalThis.coverageProbeRuns = (globalThis.coverageProbeRuns || 0) + 1;\n';

async function readCaptures(directory) {
  const files = (await readdir(directory)).filter(name => name.endsWith('.json'));
  return Promise.all(files.map(async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'))));
}

function probeScriptIds(capture) {
  return new Set(capture.snapshots.flatMap(snapshot => snapshot.entries)
    .filter(entry => entry.source === PROBE).map(entry => entry.scriptId));
}

test('user keeps coverage for every page a scenario opens, reloads, and closes in its context', async ({ page, context }, testInfo) => {
  // Given coverage follows the scenario context while its first page runs the probe script.
  const directory = testInfo.outputPath('captures');
  await mkdir(directory, { recursive: true });
  await context.route(ORIGIN + '/**', route => route.fulfill(route.request().url().endsWith('/probe.js')
    ? { contentType: 'application/javascript', body: PROBE }
    : { contentType: 'text/html', body: '<!doctype html><script src="/probe.js"></script>' }));
  const finishContextPages = await coverContextPages(context, page, directory, testInfo);
  await page.goto(ORIGIN + '/');

  // When a second tab opens and reloads its document, and the first tab closes before teardown.
  const other = await context.newPage();
  await other.goto(ORIGIN + '/');
  await checkpointBrowserCoverage(other, 'before-reload');
  await other.reload();
  await page.close();
  await finishContextPages();

  // Then each page writes one capture from its own session, including both reloaded documents.
  const captures = await readCaptures(directory);
  expect(captures.map(capture => capture.testId)).toEqual([testInfo.testId, testInfo.testId]);
  expect(new Set(captures.map(capture => capture.sessionId)).size).toBe(2);
  expect(captures.map(capture => capture.snapshots.map(snapshot => snapshot.phase).join(' > ')).sort())
    .toEqual(['before-reload > finish', 'finish']);
  expect(captures.map(capture => probeScriptIds(capture).size).sort()).toEqual([1, 2]);
});
