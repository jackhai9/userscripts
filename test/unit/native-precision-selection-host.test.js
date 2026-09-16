import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installNativePrecisionSelectionHost } from '../helpers/native-precision-selection-host.js';

test('user sees a native precision selection only after the host commits its captured click', t => {
  // Given a native option has an observable selected value and its delivery is held.
  const dom = new JSDOM('<div class="bn-select-bubble"><button data-precision-value="0.01">0.01</button></div>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const option = document.querySelector('button');
  const selected = [];
  option.addEventListener('click', () => selected.push(option.dataset.precisionValue));
  const host = installNativePrecisionSelectionHost({ ownerDocument: document });

  // When the native option is clicked before its commit is available.
  option.click();

  // Then the host records one exact option while the original listener has not run.
  assert.deepEqual(host.snapshot().map(({ value }) => value), ['0.01']);
  assert.equal(Number.isFinite(host.snapshot()[0].at), true);
  assert.deepEqual(selected, []);

  // When the pending click is committed and the host is disposed before another click.
  host.commit();
  host.dispose();
  option.click();

  // Then each native delivery runs once and replay never creates an extra captured request.
  assert.deepEqual(selected, ['0.01', '0.01']);
  assert.deepEqual(host.snapshot().map(({ value }) => value), ['0.01']);
});

test('user cannot commit a native precision option that was detached or never requested', t => {
  // Given a native option and an active host have not received a selection.
  const dom = new JSDOM('<div class="bn-select-bubble"><button data-precision-value="0.01">0.01</button></div>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const option = document.querySelector('button');
  let selected = 0;
  option.addEventListener('click', () => { selected += 1; });
  const host = installNativePrecisionSelectionHost({ ownerDocument: document });

  // When a commit is requested before the native option has been clicked.
  const beforeSelection = () => host.commit();

  // Then the missing request is rejected without a native selection.
  assert.throws(beforeSelection, /connected pending option/);
  assert.equal(selected, 0);

  // When the requested native option is detached before a later commit.
  option.click();
  option.remove();
  const afterRemoval = () => host.commit();

  // Then invalid delivery is rejected and the original native listener remains untouched.
  assert.throws(afterRemoval, /connected pending option/);
  assert.equal(selected, 0);
  host.dispose();
});

test('user keeps unrelated native option controls outside the precision selection host', t => {
  // Given a similarly named option belongs to another native control.
  const dom = new JSDOM('<button data-precision-value="0.01">Other option</button>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  let selected = 0;
  document.querySelector('button').addEventListener('click', () => { selected += 1; });
  const host = installNativePrecisionSelectionHost({ ownerDocument: document });

  // When the user clicks that control.
  document.querySelector('button').click();

  // Then its native listener runs directly and no precision request is manufactured.
  assert.equal(selected, 1);
  assert.deepEqual(host.snapshot(), []);
  host.dispose();
});
