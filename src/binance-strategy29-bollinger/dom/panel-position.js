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
    if (event.button !== 0 || event.target.closest('button,a')) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    event.preventDefault();
  }
  function onMove(event) {
    if (!drag) return;
    apply({ left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y });
  }
  function finish() {
    if (!drag) return;
    drag = null;
    clamp();
    savePosition({ ...position });
  }
  clamp();
  header.style.cursor = 'move';
  header.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', finish);
  view.addEventListener('blur', finish);
  view.addEventListener('resize', clamp);
  return Object.freeze({
    clamp,
    destroy() {
      drag = null;
      header.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', finish);
      view.removeEventListener('blur', finish);
      view.removeEventListener('resize', clamp);
    },
  });
}
