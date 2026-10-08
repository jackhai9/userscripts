import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installPanelPosition } from '../../src/shared/panel-position.js';

test('user restores a bottom-anchored status at its saved position without stretching it', () => {
  // Given an auto-height status was originally positioned from the viewport bottom
  const dom = new JSDOM('<div style="position:fixed;bottom:40px;right:20px">Strategy 31</div>');
  const panel = dom.window.document.querySelector('div');
  const saved = [];

  // When its saved top and left position is applied
  const controller = installPanelPosition(dom.window.document, panel, panel, {
    initialPosition: { left: 120, top: 300 }, savePosition: position => saved.push(position),
  });

  // Then the opposite anchors no longer determine its height or width
  assert.equal(panel.style.left, '120px');
  assert.equal(panel.style.top, '300px');
  assert.equal(panel.style.right, 'auto');
  assert.equal(panel.style.bottom, 'auto');
  assert.deepEqual(saved, []);
  controller.destroy();
  dom.window.close();
});
