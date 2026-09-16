import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, productionSourceFiles, relativeSourcePath } from './config.mjs';

let originals;
const sessions = new WeakMap();

async function originalSources() {
  originals ??= productionSourceFiles().then(async (paths) => new Set(
    await Promise.all(paths.map((path) => readFile(resolve(ROOT, path), 'utf8'))),
  ));
  return originals;
}

export async function startBrowserCoverage(page) {
  assert.equal(sessions.has(page), false, 'A page can have only one active coverage session');
  const client = await page.context().newCDPSession(page);
  const state = { client, sessionId: randomUUID(), sources: new Map(), snapshots: [] };
  sessions.set(page, state);
  client.on('Debugger.scriptParsed', ({ scriptId }) => {
    assert.equal(state.sources.has(scriptId), false, 'Script IDs must remain unique within a CDP session');
    // Resolve while the execution context still exists, before navigation can
    // discard it. Collection fails if an executed script's bytes are unavailable.
    state.sources.set(scriptId, client.send('Debugger.getScriptSource', { scriptId }).then(
      ({ scriptSource }) => ({ source: scriptSource }),
      error => ({ error }),
    ));
  });
  await client.send('Debugger.enable');
  await client.send('Profiler.enable');
  await client.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

export async function checkpointBrowserCoverage(page, phase) {
  const state = sessions.get(page);
  assert.ok(state, 'Browser coverage must be started before a checkpoint');
  const { result } = await state.client.send('Profiler.takePreciseCoverage');
  const entries = [];
  for (const entry of result) {
    assert.ok(state.sources.has(entry.scriptId), 'Every captured script must have a parsed-source record');
    const captured = await state.sources.get(entry.scriptId);
    if (captured.error) throw captured.error;
    entries.push({ ...entry, source: captured.source });
  }
  state.snapshots.push({ phase, entries });
}

export async function stopBrowserCoverage(page) {
  const state = sessions.get(page);
  assert.ok(state, 'Browser coverage must be started before collection finishes');
  try {
    await checkpointBrowserCoverage(page, 'finish');
    return { sessionId: state.sessionId, snapshots: state.snapshots };
  } finally {
    await state.client.send('Profiler.stopPreciseCoverage');
    await state.client.send('Profiler.disable');
    await state.client.send('Debugger.disable');
    await state.client.detach();
    sessions.delete(page);
  }
}

export async function finishBrowserCoverage(page, outputDirectory, testInfo) {
  const capture = await stopBrowserCoverage(page);
  const sources = await originalSources();
  const snapshots = capture.snapshots.map(snapshot => ({
    ...snapshot,
    entries: snapshot.entries.filter(entry => entry.source.includes('// ==UserScript==') || sources.has(entry.source)),
  }));
  await writeFile(resolve(outputDirectory, randomUUID() + '.json'), JSON.stringify({
    testId: testInfo.testId,
    testFile: relativeSourcePath(testInfo.file),
    sessionId: capture.sessionId,
    snapshots,
  }));
}
