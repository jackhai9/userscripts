import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createDraggableStatusView } from '../../src/shared/draggable-status-view.js';

test('user sees each independent status positioned only after its complete text is mounted', () => {
  // Given two status owners have separate saved positions and preference adapters
  const dom = new JSDOM('<body></body>');
  const writes = [];
  const measured = [];
  const one = createDraggableStatusView(dom.window, {
    id: 'status-one', loadPosition: () => null, savePosition: position => writes.push(position),
    defaultPosition: node => {
      measured.push({ text: node.textContent, mounted: node.isConnected });
      return { left: 40, top: 60 };
    },
  });
  const two = createDraggableStatusView(dom.window, {
    id: 'status-two', loadPosition: () => ({ left: 80, top: 120 }), savePosition: position => writes.push(position),
    defaultPosition: () => { throw new Error('Saved position should be used'); },
  });

  // When each status is shown and one receives longer error text
  one.show('Strategy 27');
  two.show('Strategy 31');
  const node = dom.window.document.getElementById('status-one');
  one.show('Strategy 27: gateway disconnected', 'error');
  one.hide();

  // Then hiding one does not remove or reposition the other or save any setting
  assert.deepEqual(measured, [{ text: 'Strategy 27', mounted: true }]);
  assert.equal(node.style.borderColor, 'rgb(246, 70, 93)');
  assert.equal(node.isConnected, false);
  assert.equal(two.visible, true);
  assert.equal(dom.window.document.getElementById('status-two').style.left, '80px');
  assert.equal(dom.window.document.getElementById('status-two').style.top, '120px');
  assert.deepEqual(writes, []);
  one.dispose();
  two.dispose();
  dom.window.close();
});

test('user cannot revive a disposed status or replace valid text with invalid state', () => {
  // Given a visible status has a valid text and position
  const dom = new JSDOM('<body></body>');
  const status = createDraggableStatusView(dom.window, {
    id: 'status', loadPosition: () => ({ left: 30, top: 40 }),
    savePosition: () => {}, defaultPosition: () => ({ left: 0, top: 0 }),
  });
  status.show('Strategy 27', 'inactive');

  // When invalid state is submitted and the owner is then disposed
  assert.throws(() => status.show('Invalid update', 'unknown'), /Status text or state is invalid/);
  const text = dom.window.document.getElementById('status').textContent;
  status.dispose();

  // Then the rejected update kept valid text and disposal prevents presentation revival
  assert.equal(text, 'Strategy 27');
  assert.throws(() => status.show('Late update'), /disposed status/);
  assert.equal(status.visible, false);
  assert.equal(dom.window.document.getElementById('status'), null);
  dom.window.close();
});
