export class OrderbookPrecisionDomError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OrderbookPrecisionDomError';
  }
}

function findPrecisionSelect(triggerElement) {
  if (!triggerElement?.isConnected) return null;
  const root = triggerElement.closest('.orderbook-tickSize');
  if (!root?.closest('#futuresOrderbook')) return null;
  const select = triggerElement.closest('.bn-select');
  if (
    !select
    || select.closest('.orderbook-tickSize') !== root
    || select.querySelector('.bn-select-trigger .tick-content') !== triggerElement
  ) {
    throw new OrderbookPrecisionDomError('Native precision trigger structure has changed');
  }
  return { root, select };
}

function readDropdownListboxId(fiber, root) {
  const ids = [];
  let owner = fiber;
  while (owner && owner.stateNode !== root) {
    const overlay = owner.memoizedProps?.overlay;
    if (overlay !== undefined) {
      const id = overlay?.props?.id;
      if (typeof id !== 'string' || !id.startsWith('bn-select-')) {
        throw new OrderbookPrecisionDomError('Native precision listbox identity is invalid');
      }
      ids.push(id);
    }
    owner = owner.return;
  }
  if (!owner || ids.length !== 1) {
    throw new OrderbookPrecisionDomError('Native precision listbox ownership is missing or ambiguous');
  }
  return ids[0];
}

/**
 * Binance's custom Select field omits aria-controls, while Dropdown.overlay keeps
 * the generated listbox ID. Read that lifecycle-stable ID only below this native
 * control's React owner. A host expando can point at either fiber branch; their
 * IDs must agree instead of treating either ancestor chain as the current tree.
 */
function getPrecisionListboxId(select, root) {
  const keys = Object.getOwnPropertyNames(select)
    .filter((key) => key.startsWith('__reactFiber$'));
  if (keys.length !== 1) {
    throw new OrderbookPrecisionDomError('Native precision React ownership is unavailable');
  }
  const fiber = select[keys[0]];
  const id = readDropdownListboxId(fiber, root);
  if (fiber.alternate && readDropdownListboxId(fiber.alternate, root) !== id) {
    throw new OrderbookPrecisionDomError('Native precision listbox identity changed between renders');
  }
  return id;
}

export function isNativeOrderbookPrecisionMenuOpen(triggerElement) {
  const target = findPrecisionSelect(triggerElement);
  return target !== null && target.select.classList.contains('active');
}

export function findNativeOrderbookPrecisionOverlay(triggerElement, isVisibleElement) {
  const target = findPrecisionSelect(triggerElement);
  if (!target || !target.select.classList.contains('active')) return null;
  const { root, select } = target;
  const listbox = root.ownerDocument.getElementById(getPrecisionListboxId(select, root));
  if (!listbox) return null;
  const overlay = listbox.parentElement;
  const bubble = overlay?.closest('.bn-select-bubble');
  if (
    !listbox.matches('.bn-select-overlay-options[role="listbox"]')
    || !overlay?.matches('.bn-select-overlay')
    || !bubble
  ) {
    throw new OrderbookPrecisionDomError('Native precision listbox structure has changed');
  }
  if (
    !bubble.classList.contains('active')
    || !isVisibleElement(bubble)
    || !isVisibleElement(overlay)
    || !isVisibleElement(listbox)
  ) return null;
  return overlay;
}
