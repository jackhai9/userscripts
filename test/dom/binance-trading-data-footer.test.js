import assert from 'node:assert/strict';
import test from 'node:test';
import { activateTradingData, createDataPanelHost } from '../helpers/data-media-migration-host.js';

async function harness(t) {
  const updatedAt = new Date(2026, 8, 12, 12, 34, 56).getTime();
  const host = createDataPanelHost(t, 'trading', { now: updatedAt });
  await host.start();
  await activateTradingData(host);
  return { ...host, footer: host.element('footer'), updatedAt };
}

test('user keeps the footer elements while sixty clock updates advance displayed seconds', { timeout: 5_000 }, async t => {
  // Given the complete trading panel has rendered a recorded update timestamp
  const h = await harness(t);
  const row = h.footer.firstElementChild;
  const labels = [...row.children];

  // When its real one-second business timer runs sixty times on the controlled clock
  for (let second = 1; second <= 60; second += 1) h.clock.tick(1_000);

  // Then both label elements are retained while the displayed age reaches sixty seconds
  assert.equal(h.footer.firstElementChild, row);
  assert.equal(row.children[0], labels[0]);
  assert.equal(row.children[1], labels[1]);
  assert.equal(labels[0].textContent, '更新于 12:34:56');
  assert.equal(labels[1].textContent, '60秒前');
});

test('user receives a same-second refresh without any footer DOM mutation', { timeout: 5_000 }, async t => {
  // Given an observed footer has just rendered its initial data timestamp
  const h = await harness(t);
  const records = [];
  const observer = new h.window.MutationObserver(mutations => records.push(...mutations));
  observer.observe(h.footer, { childList: true, subtree: true, characterData: true });
  t.after(() => observer.disconnect());

  // When returning to the tab fetches and renders new data within the same second
  h.setHidden(true);
  h.setHidden(false);
  await activateTradingData(h);

  // Then the repeated render leaves the unchanged timestamp and age nodes untouched
  assert.equal(records.length, 0);
  assert.equal(observer.takeRecords().length, 0);
  assert.equal(h.footer.firstElementChild.children[1].textContent, '0秒前');
});

test('user sees the retained timestamp label advance and elapsed seconds reset with new data', { timeout: 5_000 }, async t => {
  // Given an existing footer label belongs to a completed initial refresh
  const h = await harness(t);
  const label = h.footer.firstElementChild.children[0];
  h.setHidden(true);

  // When the user returns five minutes later and the next complete response renders
  h.clock.setTime(h.updatedAt + 300_000);
  h.setHidden(false);
  await activateTradingData(h);

  // Then the same label displays the new timestamp and a zero-second age
  assert.equal(h.footer.firstElementChild.children[0], label);
  assert.equal(label.textContent, '更新于 12:39:56');
  assert.equal(h.footer.firstElementChild.children[1].textContent, '0秒前');
});
