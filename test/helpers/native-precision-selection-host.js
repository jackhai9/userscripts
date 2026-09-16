/** Hold the native Select's click delivery while the real userscript observes its field. */
export function installNativePrecisionSelectionHost({ ownerDocument = document } = {}) {
  const requests = [];
  let pending = null;
  let releasing = false;
  let disposed = false;
  const capture = event => {
    if (releasing) return;
    const option = event.target.closest?.('.bn-select-bubble [data-precision-value]');
    if (!option) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pending = option;
    requests.push({ value: option.dataset.precisionValue, at: ownerDocument.defaultView.Date.now() });
  };
  ownerDocument.addEventListener('click', capture, true);
  return {
    snapshot: () => requests.map(request => ({ ...request })),
    commit() {
      if (disposed || !pending?.isConnected) throw new Error('Native precision commit requires a connected pending option');
      const option = pending;
      pending = null;
      releasing = true;
      try {
        option.click();
      } finally {
        releasing = false;
      }
    },
    dispose() {
      if (disposed) throw new Error('Native precision selection host was already disposed');
      disposed = true;
      pending = null;
      ownerDocument.removeEventListener('click', capture, true);
    },
  };
}
