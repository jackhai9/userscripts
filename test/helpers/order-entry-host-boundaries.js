/** Model the native order-type tab's request and later committed selection separately. */
export function installNativePostOnlyTransition({ ownerDocument = document } = {}) {
  const root = ownerDocument.querySelector('.order-type-tabs');
  const postOnly = root?.querySelector('[role="tab"][data-tab-key="POST_ONLY"]');
  if (!root || !postOnly || root.querySelectorAll('[role="tab"]').length !== 1) {
    throw new Error('The native order-type boundary requires one existing Post Only tab');
  }
  const originalSelection = postOnly.getAttribute('aria-selected');
  const limit = ownerDocument.createElement('div');
  limit.setAttribute('role', 'tab');
  limit.setAttribute('data-tab-key', 'LIMIT');
  limit.setAttribute('aria-selected', 'true');
  limit.textContent = '限价';
  root.prepend(limit);
  postOnly.setAttribute('aria-selected', 'false');
  let requests = 0;
  let committed = false;
  let disposed = false;
  const request = () => { requests += 1; };
  postOnly.addEventListener('click', request);
  return {
    snapshot() {
      return {
        requests,
        committed,
        selected: Array.from(root.querySelectorAll('[role="tab"][aria-selected="true"]'))
          .map(tab => tab.getAttribute('data-tab-key')),
      };
    },
    commit() {
      if (disposed || committed || requests === 0) {
        throw new Error('A native Post Only request must be pending before commit');
      }
      committed = true;
      limit.setAttribute('aria-selected', 'false');
      postOnly.setAttribute('aria-selected', 'true');
    },
    dispose() {
      if (disposed) throw new Error('The native Post Only boundary is already disposed');
      disposed = true;
      postOnly.removeEventListener('click', request);
      postOnly.setAttribute('aria-selected', originalSelection);
      limit.remove();
    },
  };
}

/**
 * Model the native form's mode commit before its separate quantity publication.
 * This boundary owns only the native DOM transition, not account or order APIs.
 */
export function installNativeCloseQuantityTransition({ ownerDocument = document } = {}) {
  const root = ownerDocument.querySelector('#trade-form');
  const openTab = root?.querySelector('[data-trade-mode="OPEN"]');
  const closeTab = root?.querySelector('[data-trade-mode="CLOSE"]');
  const entry = root?.querySelector('.order-entry');
  const price = entry?.querySelector('input[id^="limitPrice-"]');
  const quantity = entry?.querySelector('input[id^="unitAmount-"]');
  const buttons = Array.from(entry?.querySelectorAll('button') || []);
  if (!root || !openTab || !closeTab || !entry || !price || !quantity || buttons.length !== 2
    || openTab.getAttribute('aria-selected') !== 'true') {
    throw new Error('The native close transition requires one complete open form');
  }
  entry.querySelectorAll('[data-testid="max-sell-amount"], [data-testid="max-buy-amount"]')
    .forEach(node => node.remove());
  let phase = 'open';
  let requests = 0;
  let disposed = false;
  const request = event => {
    event.stopImmediatePropagation();
    if (phase !== 'open') throw new Error('The native close transition has already started');
    requests += 1;
    phase = 'quantity-pending';
    openTab.setAttribute('aria-selected', 'false');
    closeTab.setAttribute('aria-selected', 'true');
    price.id = 'limitPrice-close';
    quantity.id = 'unitAmount-close';
    buttons[0].textContent = '平多';
    buttons[1].textContent = '平空';
    buttons.forEach(button => { button.disabled = true; });
  };
  // The document's userscript listener still receives the real click first.
  closeTab.addEventListener('click', request, true);
  return {
    snapshot() {
      return {
        phase,
        requests,
        selectedMode: root.querySelector('[data-trade-mode][aria-selected="true"]')?.getAttribute('data-trade-mode'),
        quantities: Array.from(entry.querySelectorAll('[data-testid^="max-"]')).map(node => node.textContent),
        buttons: buttons.map(button => ({ text: button.textContent, disabled: button.disabled })),
      };
    },
    publish({ longQty, shortQty }) {
      if (disposed || phase !== 'quantity-pending') throw new Error('Native close quantities are not pending');
      if (![longQty, shortQty].every(value => typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))) {
        throw new Error('Native close quantities must be explicit non-negative decimal strings');
      }
      for (const [testId, value] of [['max-sell-amount', longQty], ['max-buy-amount', shortQty]]) {
        const node = ownerDocument.createElement('div');
        node.setAttribute('data-testid', testId);
        node.textContent = `可平 ${value} HYPE`;
        entry.append(node);
      }
      buttons[0].disabled = Number(longQty) === 0;
      buttons[1].disabled = Number(shortQty) === 0;
      phase = 'complete';
    },
    dispose() {
      if (disposed) throw new Error('The native close boundary is already disposed');
      disposed = true;
      closeTab.removeEventListener('click', request, true);
    },
  };
}

/** Count actual DOM work while forwarding native results, exceptions, and receivers unchanged. */
export function installOrderEntryReadProbe({ ownerDocument = document } = {}) {
  const view = ownerDocument.defaultView;
  const orderbook = ownerDocument.querySelector('#futuresOrderbook');
  const panel = ownerDocument.querySelector('#jh-binance-close-qty-multiplier-panel');
  const spacer = ownerDocument.querySelector('#jh-binance-close-qty-multiplier-spacer');
  if (!view || !orderbook || !panel || !spacer) throw new Error('Read instrumentation requires the native book and mounted panel');
  const counts = {
    queryCalls: 0,
    orderbookScans: 0,
    layoutReads: 0,
    orderbookLayoutReads: 0,
    spacerRectReads: 0,
    panelHeightReads: 0,
    panelMutations: 0,
  };
  const replacements = [];
  let disposed = false;
  const inOrderbook = node => node === orderbook || orderbook.contains(node);
  const replaceMethod = (owner, key, observe) => {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (typeof descriptor?.value !== 'function') throw new Error(`Native method ${key} is unavailable`);
    const replacement = function (...args) {
      const result = Reflect.apply(descriptor.value, this, args);
      observe(this, result);
      return result;
    };
    Object.defineProperty(owner, key, { ...descriptor, value: replacement });
    replacements.push({ owner, key, descriptor, replacement, kind: 'value' });
  };
  const observeQuery = (root, nodes) => {
    counts.queryCalls += 1;
    if (inOrderbook(root) || Array.from(nodes).some(inOrderbook)) counts.orderbookScans += 1;
  };
  for (const owner of [view.Document.prototype, view.Element.prototype]) {
    replaceMethod(owner, 'querySelectorAll', observeQuery);
  }
  for (const key of ['getBoundingClientRect', 'getClientRects']) {
    replaceMethod(view.Element.prototype, key, element => {
      counts.layoutReads += 1;
      if (inOrderbook(element)) counts.orderbookLayoutReads += 1;
      if (element === spacer && key === 'getBoundingClientRect') counts.spacerRectReads += 1;
    });
  }
  for (const key of ['offsetWidth', 'offsetHeight']) {
    const owner = view.HTMLElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (typeof descriptor?.get !== 'function') throw new Error(`Native property ${key} is unavailable`);
    const replacement = function () {
      const result = Reflect.apply(descriptor.get, this, []);
      counts.layoutReads += 1;
      if (inOrderbook(this)) counts.orderbookLayoutReads += 1;
      if (this === panel && key === 'offsetHeight') counts.panelHeightReads += 1;
      return result;
    };
    Object.defineProperty(owner, key, { ...descriptor, get: replacement });
    replacements.push({ owner, key, descriptor, replacement, kind: 'get' });
  }
  const observer = new view.MutationObserver(records => { counts.panelMutations += records.length; });
  observer.observe(panel, { attributes: true, childList: true, characterData: true, subtree: true });
  return {
    snapshot() {
      counts.panelMutations += observer.takeRecords().length;
      return { ...counts };
    },
    dispose() {
      if (disposed) throw new Error('Read instrumentation is already disposed');
      disposed = true;
      counts.panelMutations += observer.takeRecords().length;
      observer.disconnect();
      for (const { owner, key, descriptor, replacement, kind } of replacements.reverse()) {
        if (Object.getOwnPropertyDescriptor(owner, key)[kind] !== replacement) {
          throw new Error(`Native ${key} changed while read instrumentation was active`);
        }
        Object.defineProperty(owner, key, descriptor);
      }
      return { ...counts };
    },
  };
}
