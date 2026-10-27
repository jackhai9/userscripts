import assert from 'node:assert/strict';
import test from 'node:test';
import { createChartMarkerOverlay } from '../../src/shared/chart-marker-overlay.js';
import { findBearishBollingerChartTarget } from '../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { createStrategy29ChartHost } from '../helpers/strategy29-runtime-boundary-host.js';

const current = { isCurrent: () => true };

function marker(overrides = {}) {
  return { id: 'warning', time: 60, price: 100, shape: 'circle', color: '#F6465D',
    size: 10, anchor: 'center', type: 'warning', direction: 'bearish', ...overrides };
}

test('user releases chart ownership when the TradingView frame is removed with a redraw pending', t => {
  // Given rendered markers and a redraw scheduled by a native data update
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  const layer = createChartMarkerOverlay(findBearishBollingerChartTarget(host.document, 'BTRUSDT'), { maxMarkers: 10 });
  assert.equal(layer.render([marker()], current), true);
  host.overlay.events.dataUpdated.emit();
  assert.equal(host.overlay.pendingFrames, 1);

  // When Binance removes the chart frame and the strategy clears its layer
  host.overlay.detachChartFrame();
  const cleared = layer.clear();

  // Then every chart subscription, frame and marker of the old chart is released
  assert.equal(cleared, true);
  assert.equal(host.overlay.subscriptions, 0);
  assert.equal(host.overlay.pendingFrames, 0);
  assert.equal(host.overlay.markers().length, 0);
  assert.deepEqual(layer.overlayStats, {
    renderedFrames: 1, visibleMarkers: 0, signalCount: 0, attached: false, pendingFrame: false, subscriptions: 0,
  });
});

test('user keeps page visibility changes away from a cleared overlay of a removed chart', t => {
  // Given a cleared overlay whose chart frame was removed during a pending redraw
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  const layer = createChartMarkerOverlay(findBearishBollingerChartTarget(host.document, 'BTRUSDT'), { maxMarkers: 10 });
  layer.render([marker()], current);
  host.overlay.events.dataUpdated.emit();
  host.overlay.detachChartFrame();
  layer.clear();

  // When the page is hidden and shown again
  host.overlay.setHidden(true);
  host.overlay.setHidden(false);

  // Then no redraw is scheduled for the removed chart
  assert.equal(host.overlay.pendingFrames, 0);
  assert.equal(layer.overlayStats.pendingFrame, false);
});
