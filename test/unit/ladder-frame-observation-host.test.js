import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installFrameObservationHost } from '../../e2e/binance-orderbook/helpers/ladder-frame-observation-host.js';

test('user retains timer delivery and cancellation while paint callbacks are held', async (context) => {
  // Given a visible browser with the paint boundary explicitly held.
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('', { pretendToBeVisual: true });
  const view = dom.window;
  const host = installFrameObservationHost(view);
  const events = [];
  host.hold();
  try {
    // When timers run and a queued frame is cancelled before release.
    const cancelled = view.requestAnimationFrame(() => events.push('cancelled'));
    const frame = new Promise(resolve => view.requestAnimationFrame(timestamp => {
      events.push('frame');
      resolve(timestamp);
    }));
    view.cancelAnimationFrame(cancelled);
    view.setTimeout(() => events.push('timer'), 10);
    context.mock.timers.tick(10);

    // Then foreground visibility and timers remain independent from held paints.
    assert.equal(view.document.hidden, false);
    assert.deepEqual(events, ['timer']);
    assert.deepEqual(host.snapshot(), { held: true, queued: 1, scheduled: 0 });

    // When the native scheduler receives the explicitly released callbacks.
    host.release();
    const timestamp = await frame;

    // Then the remaining callback runs once with the native timestamp.
    assert.equal(typeof timestamp, 'number');
    assert.deepEqual(events, ['timer', 'frame']);
    assert.deepEqual(host.snapshot(), { held: false, queued: 0, scheduled: 0 });
  } finally {
    view.close();
  }
});
