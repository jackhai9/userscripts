/** Models the inspected coordinate/delegate boundary without entering native drawings. */
export function installMarkerOverlayHost({ document, chart, rows }) {
  const pane = document.createElement('div');
  pane.className = 'chart-gui-wrapper';
  pane.style.cssText = 'position:relative;width:900px;height:500px;background:#181a20';
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 500;
  pane.append(canvas);
  document.body.append(pane);
  const events = {};
  for (const name of ['logicalRangeChanged', 'barSpacingChanged', 'rightOffsetChanged', 'priceRangeChanged', 'modeChanged', 'internalHeightChanged', 'dataUpdated']) {
    const listeners = new Map();
    events[name] = {
      subscribe(owner, callback) { listeners.set(callback, owner); },
      unsubscribe(owner, callback) {
        if (listeners.get(callback) !== owner) throw new Error('Subscription owner mismatch');
        listeners.delete(callback);
      },
      emit() { for (const callback of listeners.keys()) callback(); },
    };
  }
  let offset = 0;
  let spacing = 2;
  let inset = 10;
  const time = {
    timePointToIndex(timestamp, mode) {
      if (mode !== 0 && mode !== 1) throw new Error('Expected exact or prior timestamp lookup');
      const index = mode === 0 ? rows.findIndex(row => row[0] === timestamp)
        : rows.findLastIndex(row => row[0] <= timestamp);
      return index < 0 ? null : index;
    },
    indexToCoordinate: index => index * spacing + inset + offset,
    logicalRangeChanged: () => events.logicalRangeChanged,
    barSpacingChanged: () => events.barSpacingChanged,
    rightOffsetChanged: () => events.rightOffsetChanged,
  };
  const price = {
    priceToCoordinate: value => 400 - value * 2,
    coordinateToPrice: value => (400 - value) / 2,
    priceRangeChanged: () => events.priceRangeChanged,
    modeChanged: () => events.modeChanged,
    internalHeightChanged: () => events.internalHeightChanged,
  };
  const series = { priceScale: () => price, firstValue: () => 100, dataUpdated: () => events.dataUpdated };
  const paneState = {};
  const model = { mainSeries: () => series, timeScale: () => time, paneForSource: () => paneState };
  const paneWidget = { canvasElement: () => canvas };
  chart._chartWidget = { model: () => ({ model: () => model }), paneByState: () => paneWidget };
  chart.getSeries = () => ({ data: () => ({ valueAt: index => rows[index] || null }) });
  function paintCandles() {
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#30343d';
    for (const y of [100, 200, 300, 400]) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(900, y); context.stroke();
    }
    for (const [index, row] of rows.entries()) {
      const x = time.indexToCoordinate(index);
      if (x < 0 || x > canvas.width) continue;
      context.strokeStyle = '#a4aab6';
      context.beginPath(); context.moveTo(x, price.priceToCoordinate(row[2]));
      context.lineTo(x, price.priceToCoordinate(row[3])); context.stroke();
      context.fillStyle = '#6c7485';
      const top = price.priceToCoordinate(Math.max(row[1], row[4]));
      const bottom = price.priceToCoordinate(Math.min(row[1], row[4]));
      context.fillRect(x - 3, top, 6, Math.max(1, bottom - top));
    }
  }
  paintCandles();
  return { pane, events,
    pan(value) { offset = value; paintCandles(); events.logicalRangeChanged.emit(); },
    setSpacing(value, left) {
      if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(left)) throw new Error('Invalid fixture spacing');
      spacing = value; inset = left; paintCandles(); events.barSpacingChanged.emit();
    },
  };
}
