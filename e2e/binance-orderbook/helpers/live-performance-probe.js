const DEFAULT_GLOBAL_NAME = '__BINANCE_LIVE_PERFORMANCE_PROBE__';

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertFiniteNonNegative(value, path) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a finite non-negative number`);
  }
}

export function validateLivePerformanceProbeSnapshot(snapshot) {
  assertRecord(snapshot, 'probe');
  if (snapshot.schemaVersion !== 1) throw new Error('probe.schemaVersion must equal 1');
  if (typeof snapshot.sessionId !== 'string' || snapshot.sessionId.length === 0) {
    throw new Error('probe.sessionId must be a non-empty string');
  }
  if (typeof snapshot.scenarioName !== 'string' || snapshot.scenarioName.length === 0) {
    throw new Error('probe.scenarioName must be a non-empty string');
  }
  if (typeof snapshot.capturedAt !== 'string' || Number.isNaN(Date.parse(snapshot.capturedAt))) {
    throw new Error('probe.capturedAt must be an ISO timestamp');
  }
  if (
    typeof snapshot.startedAtWallClock !== 'string'
    || Number.isNaN(Date.parse(snapshot.startedAtWallClock))
  ) {
    throw new Error('probe.startedAtWallClock must be an ISO timestamp');
  }
  for (const field of [
    'timeOriginMs',
    'armedAtMonotonicMs',
    'startedAtMonotonicMs',
    'finishedAtMonotonicMs',
  ]) {
    assertFiniteNonNegative(snapshot[field], `probe.${field}`);
  }
  if (!(snapshot.armedAtMonotonicMs <= snapshot.startedAtMonotonicMs
    && snapshot.startedAtMonotonicMs <= snapshot.finishedAtMonotonicMs)) {
    throw new Error('probe monotonic timestamps are out of order');
  }
  assertRecord(snapshot.performanceSupport, 'probe.performanceSupport');
  if (snapshot.performanceSupport.longTask !== true) {
    throw new Error('probe requires longtask performance evidence');
  }
  if (snapshot.performanceSupport.longAnimationFrame !== true) {
    throw new Error('probe requires long-animation-frame performance evidence');
  }
  assertRecord(snapshot.dropped, 'probe.dropped');
  for (const stream of ['events', 'errors', 'longTasks', 'longAnimationFrames']) {
    if (!Number.isInteger(snapshot.dropped[stream]) || snapshot.dropped[stream] < 0) {
      throw new Error(`probe.dropped.${stream} must be a non-negative integer`);
    }
    if (snapshot.dropped[stream] !== 0) {
      throw new Error(`probe.${stream} overflowed by ${snapshot.dropped[stream]} entries`);
    }
    if (!Array.isArray(snapshot[stream])) throw new Error(`probe.${stream} must be an array`);
  }
  if (snapshot.errors.length !== 0) throw new Error('probe captured uncaught errors');
  if (!snapshot.events.some((event) => event.kind === 'cancel-click')) {
    throw new Error('probe did not capture the userscript cancel click');
  }
  return snapshot;
}

export function installBinanceLivePerformanceProbe(options = {}) {
  const globalName = options.globalName || '__BINANCE_LIVE_PERFORMANCE_PROBE__';
  const panelSelector = options.panelSelector || '#jh-binance-close-qty-multiplier-panel';
  const cancelButtonSelector = options.cancelButtonSelector
    || '[data-ladder-cancel-symbol="true"]';
  const statusSelector = options.statusSelector || '#jh-binance-ladder-status';
  const dialogSelector = options.dialogSelector
    || '[role="dialog"], [class*="modal"], [class*="Modal"]';
  const eventLimit = options.eventLimit || 200;
  const errorLimit = options.errorLimit || 50;
  const performanceLimit = options.performanceLimit || 100;
  const limits = { eventLimit, errorLimit, performanceLimit };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  }
  if (!document.body) throw new Error('Live performance probe requires document.body');
  if (window[globalName]) throw new Error(`Live performance probe already installed: ${globalName}`);
  if (typeof crypto?.randomUUID !== 'function') {
    throw new Error('Live performance probe requires crypto.randomUUID');
  }

  const isVisible = (element) => Boolean(element && element.getClientRects().length);
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const matchesDialogText = (value) => /取消全部订单|Cancel all orders/i.test(value);
  const elementFromNode = (node) => (
    node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  );
  const touchesSelector = (node, selector) => {
    const element = elementFromNode(node);
    if (!element) return false;
    return Boolean(
      element.matches?.(selector)
      || element.closest?.(selector)
      || element.querySelector?.(selector),
    );
  };
  const childMutationTouchesScope = (mutation) => {
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => (
      touchesSelector(node, panelSelector) || touchesSelector(node, dialogSelector)
    ));
  };
  const readPanel = () => document.querySelector(panelSelector);
  const readCancelButton = (panel = readPanel()) => panel?.querySelector(cancelButtonSelector) || null;
  const readStatus = (panel = readPanel()) => panel?.querySelector(statusSelector) || null;
  const readDialog = () => Array.from(document.querySelectorAll(dialogSelector))
    .filter(isVisible)
    .filter((dialog) => matchesDialogText(normalizeText(dialog.textContent)))
    .reduce((innermost, dialog) => (
      innermost?.contains(dialog) ? dialog : (innermost || dialog)
    ), null);
  const readSemanticState = () => {
    const panel = readPanel();
    const cancelButton = readCancelButton(panel);
    const dialog = readDialog();
    return {
      panelPresent: Boolean(panel),
      cancelButtonPresent: Boolean(cancelButton),
      cancelButtonText: normalizeText(cancelButton?.textContent),
      cancelButtonDisabled: Boolean(cancelButton?.disabled),
      statusText: normalizeText(readStatus(panel)?.textContent),
      dialogVisible: Boolean(dialog),
      dialogText: normalizeText(dialog?.textContent),
    };
  };

  let destroyed = false;
  let run = null;
  let panelObserver = null;
  let observedPanel = null;
  let dialogObserver = null;
  let observedDialogRoot = null;
  let longTaskObserver = null;
  let longAnimationFrameObserver = null;
  let sampleQueued = false;
  const hasStarted = () => Boolean(run && run.startedAtMonotonicMs !== null);
  const isCollecting = () => Boolean(hasStarted() && run.finishedAtMonotonicMs === null);

  const appendBounded = (stream, value, limit) => {
    if (run[stream].length >= limit) {
      run.dropped[stream] += 1;
      return;
    }
    run[stream].push(value);
  };
  const relativeNow = () => (
    !hasStarted()
      ? null
      : performance.now() - run.startedAtMonotonicMs
  );
  const appendEvent = (kind, detail = null) => {
    if (!isCollecting()) return;
    appendBounded('events', { kind, atMs: relativeNow(), detail }, eventLimit);
  };
  const stopPerformanceObservers = () => {
    longTaskObserver?.disconnect();
    longAnimationFrameObserver?.disconnect();
    longTaskObserver = null;
    longAnimationFrameObserver = null;
  };
  const startPerformanceObservers = () => {
    stopPerformanceObservers();
    if (run.performanceSupport.longTask) {
      longTaskObserver = new PerformanceObserver((list) => {
        if (!isCollecting()) return;
        for (const entry of list.getEntries()) {
          appendBounded('longTasks', {
            startTime: entry.startTime,
            duration: entry.duration,
          }, performanceLimit);
        }
      });
      longTaskObserver.observe({ type: 'longtask' });
    }
    if (run.performanceSupport.longAnimationFrame) {
      longAnimationFrameObserver = new PerformanceObserver((list) => {
        if (!isCollecting()) return;
        for (const entry of list.getEntries()) {
          appendBounded('longAnimationFrames', {
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: entry.blockingDuration,
            forcedStyleAndLayoutDuration: entry.scripts?.reduce(
              (total, script) => total + (script.forcedStyleAndLayoutDuration || 0),
              0,
            ) || 0,
          }, performanceLimit);
        }
      });
      longAnimationFrameObserver.observe({ type: 'long-animation-frame' });
    }
  };
  const recordSemanticState = (trigger) => {
    if (!isCollecting()) return;
    const state = readSemanticState();
    const signature = JSON.stringify(state);
    if (signature === run.lastSemanticSignature) return;
    const previous = run.lastSemanticState;
    run.lastSemanticState = state;
    run.lastSemanticSignature = signature;
    appendEvent('semantic-state', { trigger, state });
    if (!run.firstFeedbackCaptured && signature !== run.clickSemanticSignature) {
      run.firstFeedbackCaptured = true;
      appendEvent('first-feedback', { state });
    }
    if (!previous?.dialogVisible && state.dialogVisible) appendEvent('dialog-visible');
    if (previous?.dialogVisible && !state.dialogVisible) appendEvent('dialog-hidden');
  };
  const queueSemanticSample = (trigger) => {
    if (sampleQueued || !isCollecting()) return;
    sampleQueued = true;
    queueMicrotask(() => {
      sampleQueued = false;
      if (!isCollecting()) return;
      recordSemanticState(trigger);
    });
  };
  const attachPanelObserver = () => {
    const panel = readPanel();
    if (panel === observedPanel) return;
    panelObserver?.disconnect();
    observedPanel = panel;
    panelObserver = null;
    if (!panel) return;
    panelObserver = new MutationObserver(() => queueSemanticSample('panel-mutation'));
    panelObserver.observe(panel, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'class', 'style'],
    });
  };
  const readPortalRoot = (dialog) => {
    let root = dialog;
    while (root?.parentElement && root.parentElement !== document.body) {
      root = root.parentElement;
    }
    return root?.parentElement === document.body ? root : dialog;
  };
  const attachDialogObserver = () => {
    const dialog = readDialog();
    const dialogRoot = dialog ? readPortalRoot(dialog) : null;
    if (dialogRoot === observedDialogRoot) return;
    dialogObserver?.disconnect();
    observedDialogRoot = dialogRoot;
    dialogObserver = null;
    if (!dialogRoot) return;
    dialogObserver = new MutationObserver(() => {
      queueSemanticSample('dialog-mutation');
      attachDialogObserver();
    });
    dialogObserver.observe(dialogRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'role', 'aria-hidden', 'hidden', 'disabled'],
    });
  };
  const documentObserver = new MutationObserver((mutations) => {
    if (!isCollecting()) return;
    const scopeChanged = mutations.some(childMutationTouchesScope)
      || (observedPanel && !observedPanel.isConnected)
      || (observedDialogRoot && !observedDialogRoot.isConnected);
    if (!scopeChanged) return;
    attachPanelObserver();
    attachDialogObserver();
    queueSemanticSample('document-mutation');
  });
  const stopMutationObservers = () => {
    panelObserver?.disconnect();
    dialogObserver?.disconnect();
    documentObserver.disconnect();
    panelObserver = null;
    dialogObserver = null;
    observedPanel = null;
    observedDialogRoot = null;
  };
  const startMutationObservers = () => {
    stopMutationObservers();
    documentObserver.observe(document.body, { subtree: true, childList: true });
    attachPanelObserver();
    attachDialogObserver();
  };
  const startRun = () => {
    if (!run || run.startedAtMonotonicMs !== null) return;
    run.startedAtMonotonicMs = performance.now();
    run.startedAtWallClock = new Date(
      performance.timeOrigin + run.startedAtMonotonicMs,
    ).toISOString();
    const semanticState = readSemanticState();
    run.clickSemanticSignature = JSON.stringify(semanticState);
    run.lastSemanticSignature = run.clickSemanticSignature;
    run.lastSemanticState = semanticState;
    attachPanelObserver();
    attachDialogObserver();
    startPerformanceObservers();
    appendEvent('cancel-click', { state: semanticState });
    queueSemanticSample('cancel-click');
  };
  const handleDocumentClick = (event) => {
    if (!run || run.finishedAtMonotonicMs !== null) return;
    const button = event.target?.closest?.('button');
    if (!button) return;
    const panel = readPanel();
    if (panel?.contains(button) && button.matches(cancelButtonSelector)) {
      startRun();
      return;
    }
    if (run.startedAtMonotonicMs === null) return;
    const dialog = button.closest(dialogSelector);
    if (isVisible(dialog) && matchesDialogText(normalizeText(dialog.textContent))) {
      appendEvent('dialog-action', {
        text: normalizeText(button.textContent),
        primary: button.matches('button.bn-button.bn-button__primary'),
      });
      queueSemanticSample('dialog-action');
    }
  };
  const handleError = (event) => {
    if (!isCollecting()) return;
    appendBounded('errors', {
      type: 'error',
      atMs: relativeNow(),
      message: String(event.message || ''),
    }, errorLimit);
  };
  const handleUnhandledRejection = (event) => {
    if (!isCollecting()) return;
    appendBounded('errors', {
      type: 'unhandledrejection',
      atMs: relativeNow(),
      message: String(event.reason || ''),
    }, errorLimit);
  };
  document.addEventListener('click', handleDocumentClick, true);
  window.addEventListener('error', handleError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  const cloneRun = () => structuredClone(run);
  const api = {
    arm(scenarioName) {
      if (destroyed) throw new Error('Live performance probe is destroyed');
      if (typeof scenarioName !== 'string' || scenarioName.length === 0) {
        throw new Error('scenarioName must be a non-empty string');
      }
      if (run && run.finishedAtMonotonicMs === null) {
        if (run.startedAtMonotonicMs === null && run.scenarioName === scenarioName) return cloneRun();
        throw new Error('Cannot arm while a live performance run is active');
      }
      stopPerformanceObservers();
      const armedAtMonotonicMs = performance.now();
      run = {
        schemaVersion: 1,
        sessionId: crypto.randomUUID(),
        scenarioName,
        capturedAt: new Date().toISOString(),
        timeOriginMs: performance.timeOrigin,
        armedAtMonotonicMs,
        startedAtMonotonicMs: null,
        startedAtWallClock: null,
        finishedAtMonotonicMs: null,
        performanceSupport: {
          longTask: PerformanceObserver.supportedEntryTypes?.includes('longtask') === true,
          longAnimationFrame:
            PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame') === true,
        },
        dropped: { events: 0, errors: 0, longTasks: 0, longAnimationFrames: 0 },
        events: [],
        errors: [],
        longTasks: [],
        longAnimationFrames: [],
        clickSemanticSignature: null,
        lastSemanticSignature: null,
        lastSemanticState: null,
        firstFeedbackCaptured: false,
      };
      startMutationObservers();
      return cloneRun();
    },
    snapshot() {
      if (!run) throw new Error('Live performance probe is not armed');
      return cloneRun();
    },
    finish() {
      if (!hasStarted()) throw new Error('Live performance probe has not started');
      if (run.finishedAtMonotonicMs === null) {
        recordSemanticState('finish');
        appendEvent('finished');
        run.finishedAtMonotonicMs = performance.now();
        stopPerformanceObservers();
        stopMutationObservers();
      }
      return cloneRun();
    },
    destroy() {
      if (destroyed) return run ? cloneRun() : null;
      destroyed = true;
      stopPerformanceObservers();
      stopMutationObservers();
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      delete window[globalName];
      return run ? cloneRun() : null;
    },
  };
  window[globalName] = api;
  return { globalName, installed: true };
}

export function createLivePerformanceProbeExpression(options = {}) {
  return `(${installBinanceLivePerformanceProbe.toString()})(${JSON.stringify(options)})`;
}

export async function installLivePerformanceProbe(page, options = {}) {
  return page.evaluate(installBinanceLivePerformanceProbe, options);
}

export async function armLivePerformanceProbe(page, scenarioName) {
  return page.evaluate(({ globalName, name }) => window[globalName].arm(name), {
    globalName: DEFAULT_GLOBAL_NAME,
    name: scenarioName,
  });
}

export async function finishLivePerformanceProbe(page) {
  return page.evaluate((globalName) => window[globalName].finish(), DEFAULT_GLOBAL_NAME);
}

export async function destroyLivePerformanceProbe(page) {
  return page.evaluate((globalName) => window[globalName]?.destroy?.() || null, DEFAULT_GLOBAL_NAME);
}
