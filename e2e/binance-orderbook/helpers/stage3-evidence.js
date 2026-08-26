import { createHash } from 'node:crypto';

import { createUserscriptReleaseContract } from '../../../scripts/userscript-release-contract.mjs';

const CONTRACT_FIELDS = [
  'artifact',
  'name',
  'namespace',
  'version',
  'runAt',
  'updateURL',
  'downloadURL',
  'matches',
  'sha256',
  'bytes',
  'characters',
];
const SOURCE_IDENTITY_FIELDS = ['sha256', 'bytes', 'characters'];
const EVENT_ORDER_FIELDS = [
  'domainsEnabled',
  'eventBuffersCleared',
  'reloadRequested',
  'mainFrameNavigated',
  'scriptParsed',
  'domContentLoaded',
  'interactionStarted',
  'interactionChanged',
  'interactionRestored',
  'finalState',
];
const REQUIRED_DOMAINS = ['Debugger', 'Network', 'Page', 'Runtime'];

export const STAGE3_PANEL_SELECTOR = '#jh-binance-close-qty-multiplier-panel';
export const STAGE3_REVERSIBLE_CONTROL_SELECTOR = '#jh-binance-ladder-toggle';
export const STAGE3_FINANCIAL_REQUEST_PATTERNS = Object.freeze([
  '/bapi/futures/v1/private/future/order/',
  '/bapi/futures/v1/private/future/user-data/adjustLeverage',
]);

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertExactKeys(record, expectedKeys, path) {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} keys must be exactly: ${expected.join(', ')}`);
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertIsoTimestamp(value, path) {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${path} must be an ISO timestamp`);
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
}

function sourceIdentity(source) {
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('source must be a non-empty string');
  }
  return Object.freeze({
    sha256: createHash('sha256').update(source, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(source, 'utf8'),
    characters: source.length,
  });
}

function validateSourceIdentity(identity, path) {
  assertRecord(identity, path);
  assertExactKeys(identity, SOURCE_IDENTITY_FIELDS, path);
  if (!/^[a-f0-9]{64}$/.test(identity.sha256)) {
    throw new Error(`${path}.sha256 must be a lowercase SHA-256 digest`);
  }
  for (const field of ['bytes', 'characters']) assertPositiveInteger(identity[field], `${path}.${field}`);
}

function validateReleaseContract(contract, path) {
  assertRecord(contract, path);
  assertExactKeys(contract, CONTRACT_FIELDS, path);
  for (const field of [
    'artifact',
    'name',
    'namespace',
    'version',
    'runAt',
    'updateURL',
    'downloadURL',
  ]) {
    assertNonEmptyString(contract[field], `${path}.${field}`);
  }
  if (!Array.isArray(contract.matches) || contract.matches.length === 0) {
    throw new Error(`${path}.matches must be a non-empty array`);
  }
  contract.matches.forEach((match, index) => assertNonEmptyString(match, `${path}.matches[${index}]`));
  validateSourceIdentity({
    sha256: contract.sha256,
    bytes: contract.bytes,
    characters: contract.characters,
  }, `${path}.sourceIdentity`);
}

function validateEventOrder(eventOrder) {
  assertRecord(eventOrder, 'evidence.browser.eventOrder');
  assertExactKeys(eventOrder, EVENT_ORDER_FIELDS, 'evidence.browser.eventOrder');
  const values = EVENT_ORDER_FIELDS.map((field) => {
    assertPositiveInteger(eventOrder[field], `evidence.browser.eventOrder.${field}`);
    return eventOrder[field];
  });
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      throw new Error(`evidence.browser.eventOrder.${EVENT_ORDER_FIELDS[index]} must follow ${EVENT_ORDER_FIELDS[index - 1]}`);
    }
  }
}

function validatePanel(panel) {
  assertRecord(panel, 'evidence.browser.panel');
  assertExactKeys(panel, ['selector', 'visible', 'rect'], 'evidence.browser.panel');
  if (panel.selector !== STAGE3_PANEL_SELECTOR) {
    throw new Error(`evidence.browser.panel.selector must equal ${STAGE3_PANEL_SELECTOR}`);
  }
  if (panel.visible !== true) throw new Error('evidence.browser.panel.visible must equal true');
  assertRecord(panel.rect, 'evidence.browser.panel.rect');
  assertExactKeys(panel.rect, ['x', 'y', 'width', 'height'], 'evidence.browser.panel.rect');
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(panel.rect[field])) {
      throw new Error(`evidence.browser.panel.rect.${field} must be finite`);
    }
  }
  if (panel.rect.width <= 0 || panel.rect.height <= 0) {
    throw new Error('evidence.browser.panel.rect must have positive dimensions');
  }
}

function validateInteraction(interaction) {
  assertRecord(interaction, 'evidence.interaction');
  assertExactKeys(interaction, [
    'name',
    'controlSelector',
    'before',
    'after',
    'restored',
    'financialNetworkObservation',
  ], 'evidence.interaction');
  if (interaction.name !== 'panel-collapse-toggle') {
    throw new Error('evidence.interaction.name must equal panel-collapse-toggle');
  }
  if (interaction.controlSelector !== STAGE3_REVERSIBLE_CONTROL_SELECTOR) {
    throw new Error(`evidence.interaction.controlSelector must equal ${STAGE3_REVERSIBLE_CONTROL_SELECTOR}`);
  }
  for (const state of ['before', 'after', 'restored']) {
    assertRecord(interaction[state], `evidence.interaction.${state}`);
    assertExactKeys(interaction[state], ['expanded'], `evidence.interaction.${state}`);
    if (typeof interaction[state].expanded !== 'boolean') {
      throw new Error(`evidence.interaction.${state}.expanded must be boolean`);
    }
  }
  if (interaction.after.expanded === interaction.before.expanded) {
    throw new Error('evidence.interaction.after must differ from before');
  }
  if (interaction.restored.expanded !== interaction.before.expanded) {
    throw new Error('evidence.interaction.restored must equal before');
  }
  const network = interaction.financialNetworkObservation;
  assertRecord(network, 'evidence.interaction.financialNetworkObservation');
  assertExactKeys(network, ['patterns', 'requests'], 'evidence.interaction.financialNetworkObservation');
  if (JSON.stringify(network.patterns) !== JSON.stringify(STAGE3_FINANCIAL_REQUEST_PATTERNS)) {
    throw new Error('evidence.interaction.financialNetworkObservation.patterns must match the Stage 3 contract');
  }
  if (!Array.isArray(network.requests) || network.requests.length !== 0) {
    throw new Error('Stage 3 reversible interaction must not emit financial requests');
  }
}

function validateCleanup(cleanup) {
  assertRecord(cleanup, 'evidence.cleanup');
  assertExactKeys(cleanup, [
    'pageProbeStatus',
    'eventBuffersCleared',
    'sessionReleased',
    'domains',
  ], 'evidence.cleanup');
  if (!['not-installed', 'destroyed'].includes(cleanup.pageProbeStatus)) {
    throw new Error('evidence.cleanup.pageProbeStatus must equal not-installed or destroyed');
  }
  if (cleanup.eventBuffersCleared !== true) {
    throw new Error('evidence.cleanup.eventBuffersCleared must equal true');
  }
  if (typeof cleanup.sessionReleased !== 'boolean') {
    throw new Error('evidence.cleanup.sessionReleased must be boolean');
  }
  if (!Array.isArray(cleanup.domains) || cleanup.domains.length !== REQUIRED_DOMAINS.length) {
    throw new Error('evidence.cleanup.domains must cover every required CDP domain');
  }
  const names = cleanup.domains.map((domain, index) => {
    const path = `evidence.cleanup.domains[${index}]`;
    assertRecord(domain, path);
    assertExactKeys(domain, ['name', 'status'], path);
    if (!REQUIRED_DOMAINS.includes(domain.name)) throw new Error(`${path}.name is not a required domain`);
    if (!['disabled', 'session-released'].includes(domain.status)) {
      throw new Error(`${path}.status must equal disabled or session-released`);
    }
    if (domain.status === 'session-released' && cleanup.sessionReleased !== true) {
      throw new Error(`${path} cannot claim session release while the session remains active`);
    }
    return domain.name;
  });
  if (new Set(names).size !== REQUIRED_DOMAINS.length) {
    throw new Error('evidence.cleanup.domains must contain each required domain exactly once');
  }
}

export function validateStage3Evidence(evidence) {
  assertRecord(evidence, 'evidence');
  assertExactKeys(evidence, [
    'schemaVersion',
    'capturedAt',
    'artifact',
    'tampermonkey',
    'browser',
    'interaction',
    'cleanup',
  ], 'evidence');
  if (evidence.schemaVersion !== 1) throw new Error('evidence.schemaVersion must equal 1');
  assertIsoTimestamp(evidence.capturedAt, 'evidence.capturedAt');
  validateReleaseContract(evidence.artifact, 'evidence.artifact');

  const tampermonkey = evidence.tampermonkey;
  assertRecord(tampermonkey, 'evidence.tampermonkey');
  assertExactKeys(tampermonkey, [
    'namespaceMatchCount',
    'scriptId',
    'path',
    'lastModified',
    'readbackTransport',
    'sourceIdentity',
  ], 'evidence.tampermonkey');
  if (tampermonkey.namespaceMatchCount !== 1) {
    throw new Error('evidence.tampermonkey.namespaceMatchCount must equal 1');
  }
  assertNonEmptyString(tampermonkey.scriptId, 'evidence.tampermonkey.scriptId');
  if (tampermonkey.path !== `${tampermonkey.scriptId}/source`) {
    throw new Error('evidence.tampermonkey.path must identify the same scriptId source');
  }
  if (
    !(Number.isInteger(tampermonkey.lastModified) && tampermonkey.lastModified >= 0)
    && !(typeof tampermonkey.lastModified === 'string' && !Number.isNaN(Date.parse(tampermonkey.lastModified)))
  ) {
    throw new Error('evidence.tampermonkey.lastModified must be a Unix token or ISO timestamp');
  }
  if (!['json', 'text-footer'].includes(tampermonkey.readbackTransport)) {
    throw new Error('evidence.tampermonkey.readbackTransport must equal json or text-footer');
  }
  validateSourceIdentity(tampermonkey.sourceIdentity, 'evidence.tampermonkey.sourceIdentity');

  const browser = evidence.browser;
  assertRecord(browser, 'evidence.browser');
  assertExactKeys(browser, [
    'targetId',
    'sessionId',
    'navigationId',
    'pageUrl',
    'mainFrameId',
    'loaderId',
    'eventOrder',
    'matchingScripts',
    'panel',
  ], 'evidence.browser');
  for (const field of ['targetId', 'sessionId', 'navigationId', 'pageUrl', 'mainFrameId', 'loaderId']) {
    assertNonEmptyString(browser[field], `evidence.browser.${field}`);
  }
  validateEventOrder(browser.eventOrder);
  if (!Array.isArray(browser.matchingScripts) || browser.matchingScripts.length !== 1) {
    throw new Error('evidence.browser.matchingScripts must contain exactly one main-frame script');
  }
  const script = browser.matchingScripts[0];
  assertRecord(script, 'evidence.browser.matchingScripts[0]');
  assertExactKeys(script, [
    'scriptId',
    'url',
    'executionContextId',
    'frameId',
    'isDefault',
    'sourceIdentity',
  ], 'evidence.browser.matchingScripts[0]');
  assertNonEmptyString(script.scriptId, 'evidence.browser.matchingScripts[0].scriptId');
  assertNonEmptyString(script.url, 'evidence.browser.matchingScripts[0].url');
  assertPositiveInteger(script.executionContextId, 'evidence.browser.matchingScripts[0].executionContextId');
  if (script.frameId !== browser.mainFrameId || script.isDefault !== true) {
    throw new Error('matching script must belong to the default main-frame context');
  }
  validateSourceIdentity(script.sourceIdentity, 'evidence.browser.matchingScripts[0].sourceIdentity');
  validatePanel(browser.panel);
  validateInteraction(evidence.interaction);
  validateCleanup(evidence.cleanup);
  return evidence;
}

export function createStage3Evidence(input) {
  assertRecord(input, 'input');
  assertExactKeys(input, [
    'capturedAt',
    'artifactPath',
    'artifactSource',
    'tampermonkey',
    'browser',
    'interaction',
    'cleanup',
  ], 'input');
  const artifact = createUserscriptReleaseContract(input.artifactSource, input.artifactPath);
  if (input.tampermonkey.source !== input.artifactSource) {
    throw new Error('Tampermonkey read-back source does not exactly match the artifact');
  }
  if (input.browser.matchingScript.source !== input.artifactSource) {
    throw new Error('CDP loaded source does not exactly match the artifact');
  }
  const evidence = {
    schemaVersion: 1,
    capturedAt: input.capturedAt,
    artifact,
    tampermonkey: {
      namespaceMatchCount: input.tampermonkey.namespaceMatchCount,
      scriptId: input.tampermonkey.scriptId,
      path: input.tampermonkey.path,
      lastModified: input.tampermonkey.lastModified,
      readbackTransport: input.tampermonkey.readbackTransport,
      sourceIdentity: sourceIdentity(input.tampermonkey.source),
    },
    browser: {
      targetId: input.browser.targetId,
      sessionId: input.browser.sessionId,
      navigationId: input.browser.navigationId,
      pageUrl: input.browser.pageUrl,
      mainFrameId: input.browser.mainFrameId,
      loaderId: input.browser.loaderId,
      eventOrder: structuredClone(input.browser.eventOrder),
      matchingScripts: [{
        scriptId: input.browser.matchingScript.scriptId,
        url: input.browser.matchingScript.url,
        executionContextId: input.browser.matchingScript.executionContextId,
        frameId: input.browser.matchingScript.frameId,
        isDefault: input.browser.matchingScript.isDefault,
        sourceIdentity: sourceIdentity(input.browser.matchingScript.source),
      }],
      panel: structuredClone(input.browser.panel),
    },
    interaction: structuredClone(input.interaction),
    cleanup: structuredClone(input.cleanup),
  };
  return Object.freeze(validateStage3Evidence(evidence));
}

export function verifyStage3EvidenceAgainstSources(evidence, sources) {
  validateStage3Evidence(evidence);
  assertRecord(sources, 'sources');
  assertExactKeys(sources, ['artifactSource', 'installedSource', 'loadedSource'], 'sources');
  if (sources.installedSource !== sources.artifactSource) {
    throw new Error('Tampermonkey read-back source does not exactly match the artifact');
  }
  if (sources.loadedSource !== sources.artifactSource) {
    throw new Error('CDP loaded source does not exactly match the artifact');
  }
  const artifact = createUserscriptReleaseContract(sources.artifactSource, evidence.artifact.artifact);
  if (JSON.stringify(artifact) !== JSON.stringify(evidence.artifact)) {
    throw new Error('Stage 3 artifact contract does not match the provided artifact source');
  }
  const installedIdentity = sourceIdentity(sources.installedSource);
  if (JSON.stringify(installedIdentity) !== JSON.stringify(evidence.tampermonkey.sourceIdentity)) {
    throw new Error('Stage 3 Tampermonkey source identity does not match the read-back source');
  }
  const loadedIdentity = sourceIdentity(sources.loadedSource);
  if (JSON.stringify(loadedIdentity) !== JSON.stringify(evidence.browser.matchingScripts[0].sourceIdentity)) {
    throw new Error('Stage 3 loaded source identity does not match the CDP source');
  }
  return evidence;
}
