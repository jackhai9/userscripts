import { findTradePanelInsertionPoint } from './trade-form.js';

/**
 * Fast path for the first placement after mount or foreground return. Structural
 * mutations never measure layout; once a spacer exists, ResizeObserver owns
 * zero-area recovery. Script-owned writes cannot schedule another render.
 *
 * Some pages never satisfy the placement contract (one-way mode, signed out,
 * collapsed form). A document-wide observer must not stay attached for those,
 * so each pending episode expires after `waitLimitMs` and leaves recovery to
 * the route watchdog. Only `stop()` (placement, hiding, route exit) starts a
 * new episode; repeated failed renders cannot re-arm an expired one.
 */
export function createPanelPlacementObserver(document, {
  panelId, spacerId, onReady, waitLimitMs, setTimeout, clearTimeout,
}) {
  if (!(waitLimitMs > 0) || typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
    throw new Error('Panel placement observer requires a positive wait limit and timer functions');
  }
  const view = document.defaultView;
  const ownedSelector = `#${panelId}, #${spacerId}`;
  let mutationObserver = null;
  let resizeObserver = null;
  let insertionPoint = null;
  let spacer = null;
  let expiryTimer = null;
  let expired = false;

  function isOwned(node) {
    const element = node.nodeType === view.Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest(ownedSelector));
  }

  function containsModeTabs(node) {
    return node.nodeType === view.Node.ELEMENT_NODE
      && (node.id === 'position-direction' || Boolean(node.querySelector('#position-direction')));
  }

  function isNativeModeTabsChange(nodes) {
    for (const node of nodes) {
      if (!isOwned(node) && containsModeTabs(node)) return true;
    }
    return false;
  }

  function hasNativeNode(nodes) {
    for (const node of nodes) {
      if (!isOwned(node)) return true;
    }
    return false;
  }

  function touchesNativePlacement(mutation) {
    const tabs = document.getElementById('position-direction');
    // Text changes matter only for the mode labels; checking them first keeps
    // market-data text updates to one lookup and one containment test.
    if (mutation.type === 'characterData') return Boolean(tabs?.contains(mutation.target));
    if (isOwned(mutation.target)) return false;
    if (isNativeModeTabsChange(mutation.addedNodes) || isNativeModeTabsChange(mutation.removedNodes)) return true;
    if (!tabs || (!hasNativeNode(mutation.addedNodes) && !hasNativeNode(mutation.removedNodes))) return false;
    if (tabs.contains(mutation.target)) return true;
    // The insertion contract spans the tabs, column, row, and native header.
    let owner = tabs;
    for (let level = 0; owner && level < 4; level += 1, owner = owner.parentElement) {
      if (owner === mutation.target) return true;
    }
    return false;
  }

  function stopSizeObservation() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    spacer = null;
  }

  function release() {
    mutationObserver?.disconnect();
    mutationObserver = null;
    stopSizeObservation();
    insertionPoint = null;
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function stop() {
    release();
    expired = false;
  }

  function wait(nextInsertionPoint, nextSpacer) {
    if (expired) return;
    insertionPoint = nextInsertionPoint;
    if (!mutationObserver) {
      expiryTimer = setTimeout(() => {
        expiryTimer = null;
        release();
        expired = true;
      }, waitLimitMs);
      mutationObserver = new view.MutationObserver(mutations => {
        if (!mutations.some(touchesNativePlacement)) return;
        const current = findTradePanelInsertionPoint(document);
        if (!current) {
          insertionPoint = null;
          stopSizeObservation();
          return;
        }
        if (current.parent === insertionPoint?.parent
          && current.before === insertionPoint?.before && spacer?.isConnected) return;
        onReady();
      });
      mutationObserver.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
      });
    }
    if (spacer === nextSpacer) return;
    stopSizeObservation();
    if (!nextSpacer) return;
    spacer = nextSpacer;
    resizeObserver = new view.ResizeObserver(entries => {
      const entry = entries.find(candidate => candidate.target === spacer);
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) onReady();
    });
    resizeObserver.observe(spacer);
  }

  return { wait, stop };
}
