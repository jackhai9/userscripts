import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createStage3Evidence,
  STAGE3_FINANCIAL_REQUEST_PATTERNS,
  verifyStage3EvidenceAgainstSources,
} from '../../e2e/binance-orderbook/helpers/stage3-evidence.js';
import { runStage3EvidenceVerification } from '../../scripts/binance-stage3-evidence.mjs';

const source = `// ==UserScript==
// @name         Stage 3 fixture
// @namespace    binance.orderbook.trade
// @version      1.2.3
// @match        https://www.binance.com/*/futures/*
// @updateURL    https://example.com/script.user.js
// @downloadURL  https://example.com/script.user.js
// @run-at       document-start
// ==/UserScript==
console.log('fixture');
`;

function stage3Input(overrides = {}) {
  const base = {
    capturedAt: '2026-08-26T10:00:00.000Z',
    artifactPath: 'scripts/binance-orderbook-trade.user.js',
    artifactSource: source,
    tampermonkey: {
      namespaceMatchCount: 1,
      scriptId: 'script-uuid',
      path: 'script-uuid/source',
      lastModified: 1_787_738_000,
      readbackTransport: 'json',
      source,
    },
    browser: {
      targetId: 'target-1',
      sessionId: 'session-1',
      navigationId: 'navigation-1',
      pageUrl: 'https://www.binance.com/zh-CN/futures/HYPEUSDT',
      mainFrameId: 'frame-1',
      loaderId: 'loader-1',
      eventOrder: {
        domainsEnabled: 1,
        eventBuffersCleared: 2,
        reloadRequested: 3,
        mainFrameNavigated: 4,
        scriptParsed: 5,
        domContentLoaded: 6,
        interactionStarted: 7,
        interactionChanged: 8,
        interactionRestored: 9,
        finalState: 10,
      },
      matchingScript: {
        scriptId: 'cdp-script-1',
        url: 'userscript://binance-orderbook-trade.user.js',
        executionContextId: 7,
        frameId: 'frame-1',
        isDefault: true,
        source,
      },
      panel: {
        selector: '#jh-binance-close-qty-multiplier-panel',
        visible: true,
        rect: { x: 100, y: 120, width: 280, height: 500 },
      },
    },
    interaction: {
      name: 'panel-collapse-toggle',
      controlSelector: '#jh-binance-ladder-toggle',
      before: { expanded: true },
      after: { expanded: false },
      restored: { expanded: true },
      financialNetworkObservation: {
        patterns: [...STAGE3_FINANCIAL_REQUEST_PATTERNS],
        requests: [],
      },
    },
    cleanup: {
      pageProbeStatus: 'not-installed',
      eventBuffersCleared: true,
      sessionReleased: false,
      domains: [
        { name: 'Debugger', status: 'disabled' },
        { name: 'Network', status: 'disabled' },
        { name: 'Page', status: 'disabled' },
        { name: 'Runtime', status: 'disabled' },
      ],
    },
  };
  return {
    ...base,
    ...overrides,
    tampermonkey: { ...base.tampermonkey, ...overrides.tampermonkey },
    browser: { ...base.browser, ...overrides.browser },
    interaction: { ...base.interaction, ...overrides.interaction },
    cleanup: { ...base.cleanup, ...overrides.cleanup },
  };
}

test('Stage 3 evidence binds exact artifact, MCP, CDP, interaction, and cleanup state', () => {
  const evidence = createStage3Evidence(stage3Input());

  assert.equal(evidence.artifact.namespace, 'binance.orderbook.trade');
  assert.equal(evidence.artifact.sha256, evidence.tampermonkey.sourceIdentity.sha256);
  assert.equal(
    evidence.artifact.sha256,
    evidence.browser.matchingScripts[0].sourceIdentity.sha256,
  );
  assert.equal(verifyStage3EvidenceAgainstSources(evidence, {
    artifactSource: source,
    installedSource: source,
    loadedSource: source,
  }), evidence);
});

test('Stage 3 evidence rejects duplicate MCP namespace matches and source drift', () => {
  assert.throws(
    () => createStage3Evidence(stage3Input({
      tampermonkey: { namespaceMatchCount: 2 },
    })),
    /namespaceMatchCount must equal 1/,
  );
  assert.throws(
    () => createStage3Evidence(stage3Input({
      tampermonkey: { source: `${source}\n// drift` },
    })),
    /does not exactly match/,
  );
  assert.throws(
    () => createStage3Evidence(stage3Input({
      browser: { matchingScript: { ...stage3Input().browser.matchingScript, source: `${source}\n// drift` } },
    })),
    /CDP loaded source does not exactly match/,
  );
});

test('Stage 3 evidence rejects stale navigation ordering and non-main-frame scripts', () => {
  assert.throws(
    () => createStage3Evidence(stage3Input({
      browser: {
        eventOrder: {
          ...stage3Input().browser.eventOrder,
          scriptParsed: 7,
        },
      },
    })),
    /domContentLoaded must follow scriptParsed/,
  );
  assert.throws(
    () => createStage3Evidence(stage3Input({
      browser: {
        matchingScript: { ...stage3Input().browser.matchingScript, frameId: 'iframe-1' },
      },
    })),
    /default main-frame context/,
  );
});

test('Stage 3 evidence allows only the non-financial collapse interaction', () => {
  assert.throws(
    () => createStage3Evidence(stage3Input({
      interaction: { name: 'leverage-toggle' },
    })),
    /panel-collapse-toggle/,
  );
  assert.throws(
    () => createStage3Evidence(stage3Input({
      interaction: {
        financialNetworkObservation: {
          patterns: [...STAGE3_FINANCIAL_REQUEST_PATTERNS],
          requests: ['https://www.binance.com/bapi/futures/v1/private/future/order/place-order'],
        },
      },
    })),
    /must not emit financial requests/,
  );
});

test('Stage 3 evidence requires every CDP domain to be cleaned up', () => {
  assert.throws(
    () => createStage3Evidence(stage3Input({
      cleanup: {
        domains: [
          { name: 'Debugger', status: 'disabled' },
          { name: 'Network', status: 'disabled' },
          { name: 'Page', status: 'disabled' },
          { name: 'Page', status: 'disabled' },
        ],
      },
    })),
    /exactly once/,
  );
});

test('Stage 3 CLI verifies saved MCP and CDP source evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stage3-evidence-'));
  const artifact = join(directory, 'artifact.user.js');
  const readback = join(directory, 'readback.txt');
  const loaded = join(directory, 'loaded.user.js');
  const evidencePath = join(directory, 'evidence.json');
  const evidence = createStage3Evidence(stage3Input({ artifactPath: artifact }));
  await Promise.all([
    writeFile(artifact, source),
    writeFile(readback, `${JSON.stringify({ value: source, lastModified: 1_787_738_000 })}\n`),
    writeFile(loaded, source),
    writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`),
  ]);

  const result = await runStage3EvidenceVerification([
    artifact,
    readback,
    loaded,
    evidencePath,
  ]);

  assert.equal(result.verified, true);
  assert.equal(result.userscriptVersion, '1.2.3');
});
