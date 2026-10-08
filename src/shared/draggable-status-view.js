import { installPanelPosition } from './panel-position.js';

function readPosition(loadPosition) {
  const position = loadPosition();
  if (position === null) return null;
  if (!position || typeof position !== 'object' || Object.keys(position).sort().join(',') !== 'left,top'
    || !Number.isFinite(position.left) || !Number.isFinite(position.top)) {
    throw new TypeError('Status position must contain finite left and top coordinates');
  }
  return { ...position };
}

/** Each caller owns its DOM, lifetime and private preference; only presentation code is shared. */
export function createDraggableStatusView(view, { id, loadPosition, savePosition, defaultPosition }) {
  if (typeof id !== 'string' || id.length === 0 || typeof loadPosition !== 'function'
    || typeof savePosition !== 'function' || typeof defaultPosition !== 'function') {
    throw new TypeError('Draggable status requires an ID and position adapters');
  }
  const document = view.document;
  let position = readPosition(loadPosition);
  let node = null;
  let drag = null;
  let disposed = false;

  function hide() {
    if (!node) return;
    position = drag.position;
    drag.destroy();
    node.remove();
    node = null;
    drag = null;
  }

  return Object.freeze({
    show(text, state = 'normal') {
      if (disposed) throw new Error('Cannot show a disposed status');
      if (typeof text !== 'string' || !['normal', 'inactive', 'error'].includes(state)) {
        throw new TypeError('Status text or state is invalid');
      }
      if (!node) {
        node = document.createElement('div');
        node.id = id;
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        /** Keep intrinsic width independent of the saved left offset when the viewport shrinks. */
        Object.assign(node.style, {
          position: 'fixed', zIndex: '10000', boxSizing: 'border-box',
          width: 'max-content', maxWidth: 'min(520px, calc(100vw - 16px))', padding: '6px 8px',
          border: '1px solid #474D57', borderRadius: '6px', background: '#181A20', color: '#DDD',
          font: '12px/18px BinancePlex, ui-sans-serif, system-ui, sans-serif',
          pointerEvents: 'auto', userSelect: 'none', whiteSpace: 'normal', overflowWrap: 'anywhere',
        });
        node.textContent = text;
        document.body.appendChild(node);
        /** Measure the populated status so the first saved/default placement uses its real size. */
        drag = installPanelPosition(document, node, node, {
          initialPosition: position ?? defaultPosition(node),
          savePosition(next) { position = next; savePosition(next); },
        });
      } else if (node.textContent !== text) {
        node.textContent = text;
        drag.clamp();
      }
      if (node.title !== text) node.title = text;
      if (node.dataset.state !== state) {
        node.dataset.state = state;
        node.style.borderColor = state === 'error' ? '#F6465D' : '#474D57';
      }
    },
    hide,
    get visible() { return node !== null; },
    dispose() { hide(); disposed = true; },
  });
}
