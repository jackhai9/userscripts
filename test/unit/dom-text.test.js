import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { setElementText } from '../../src/shared/dom-text.js';

function observed(element) {
  const records = [];
  const observer = new element.ownerDocument.defaultView.MutationObserver(mutations => records.push(...mutations));
  observer.observe(element, { childList: true, subtree: true, characterData: true });
  return () => {
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records.map(record => record.type);
  };
}

test('user sees a label change through its existing text node only', () => {
  // Given a label that already shows text
  const { window } = new JSDOM('<span id="label">5秒前</span>');
  const label = window.document.getElementById('label');
  const node = label.firstChild;
  const stop = observed(label);

  // When the text changes twice and is then written unchanged
  setElementText(label, '6秒前');
  setElementText(label, '');
  setElementText(label, '');

  // Then the same node carries the text and only character data changed
  assert.equal(label.firstChild, node);
  assert.equal(label.textContent, '');
  assert.deepEqual(stop(), ['characterData', 'characterData']);
});

test('user sees an empty or structured label receive its first text as one child', () => {
  // Given one empty label and one label with element children
  const { window } = new JSDOM('<span id="empty"></span><span id="mixed"><b>x</b>y</span>');
  const empty = window.document.getElementById('empty');
  const mixed = window.document.getElementById('mixed');

  // When both receive text
  setElementText(empty, '等待数据');
  setElementText(mixed, '更新于 12:00:00');

  // Then each holds exactly one text node with that text
  assert.deepEqual([...empty.childNodes].map(node => [node.nodeType, node.data]), [[3, '等待数据']]);
  assert.deepEqual([...mixed.childNodes].map(node => [node.nodeType, node.data]), [[3, '更新于 12:00:00']]);
});
