/** Header-only dragging with userscript-owned position persistence and viewport bounds. */
export function installPanelPosition(document, panel, header, { initialPosition, savePosition }) {
  const view = document.defaultView;
  if (!view) throw new Error('Strategy 29 panel window is unavailable');
  let position = initialPosition ?? { left: view.innerWidth - panel.getBoundingClientRect().width - 84, top: 68 };
  let drag = null;
  function apply(next) {
    const rect = panel.getBoundingClientRect();
    position = {
      left: Math.max(0, Math.min(next.left, Math.max(0, view.innerWidth - rect.width))),
      top: Math.max(0, Math.min(next.top, Math.max(0, view.innerHeight - rect.height))),
    };
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.style.right = 'auto';
  }
  function clamp() { apply(position); }
  function onDown(event) {
    if (drag || !event.isPrimary || event.button !== 0 || event.buttons !== 1 || event.target.closest('button,a')) return;
    const rect = panel.getBoundingClientRect();
    /** Capture keeps this drag in the parent document when crossing the chart iframe. */
    header.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.preventDefault();
  }
  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    apply({ left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y });
  }
  function release() {
    const { pointerId } = drag;
    drag = null;
    if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId);
  }
  function finish() {
    if (!drag) return;
    release();
    clamp();
    savePosition({ ...position });
  }
  function onEnd(event) {
    if (drag && event.pointerId === drag.pointerId) finish();
  }
  clamp();
  header.style.cursor = 'move';
  header.style.touchAction = 'none';
  header.addEventListener('pointerdown', onDown);
  header.addEventListener('pointermove', onMove);
  header.addEventListener('pointerup', onEnd);
  header.addEventListener('pointercancel', onEnd);
  header.addEventListener('lostpointercapture', onEnd);
  view.addEventListener('blur', finish);
  view.addEventListener('resize', clamp);
  return Object.freeze({
    clamp,
    destroy() {
      if (drag) release();
      header.removeEventListener('pointerdown', onDown);
      header.removeEventListener('pointermove', onMove);
      header.removeEventListener('pointerup', onEnd);
      header.removeEventListener('pointercancel', onEnd);
      header.removeEventListener('lostpointercapture', onEnd);
      view.removeEventListener('blur', finish);
      view.removeEventListener('resize', clamp);
    },
  });
}
