import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const artifact = new URL('../../scripts/auto_refresh.user.js', import.meta.url);
const source = await readFile(artifact, 'utf8');

function refreshHost(t, now, url = 'https://anyrouter.top/console') {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now });
  const window = new EventTarget();
  const document = new EventTarget();
  document.hidden = false;
  const menus = new Map(), alerts = [], reloads = [];
  const location = { href: url, reload() { reloads.push(Date.now()); } };
  const context = {
    Date, location, window, document, setTimeout, clearTimeout, setInterval,
    GM_registerMenuCommand(name, action) { menus.set(name, action); },
    alert(message) { alerts.push(message); },
    console: { log() {} },
  };
  return {
    window, document, location, menus, alerts, reloads, clock: t.mock.timers,
    start() { vm.runInNewContext(source, context, { filename: fileURLToPath(artifact) }); },
    visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('user reloads after regaining focus past the scheduled target without postponing it', t => {
  // Given a matching page scheduled today's 08:03 refresh while visible at 07:00
  const host = refreshHost(t, new Date(2026, 7, 23, 7).getTime());
  host.start();

  // When focus returns after the target while suspended timers have not fired
  const resumedAt = new Date(2026, 7, 23, 8, 10).getTime();
  host.clock.setTime(resumedAt);
  host.window.dispatchEvent(new Event('focus'));

  // Then focus requests a reload immediately rather than scheduling tomorrow
  assert.deepEqual(host.reloads, [resumedAt]);
});

test('user gets exactly one scheduled reload after repeated focus and manual rescheduling', t => {
  // Given a matching page starts one minute before its daily target
  const now = new Date(2026, 7, 23, 8, 2).getTime();
  const host = refreshHost(t, now);
  host.start();

  // When focus, visibility, and the menu recalculate the same target before it arrives
  host.window.dispatchEvent(new Event('focus'));
  host.visibility(true);
  host.visibility(false);
  host.menus.get('立即重新计算并安排')();
  host.clock.tick(59_999);
  assert.deepEqual(host.reloads, []);
  host.clock.tick(1);

  // Then replacing the pending timeout still requests only one reload at 08:03
  assert.deepEqual(host.reloads, [now + 60_000]);
  assert.deepEqual(host.alerts, ['已重新安排']);
});

test('user schedules tomorrow when opening the page after today\'s target', t => {
  // Given a matching page opens one minute after today's scheduled target
  const now = new Date(2026, 7, 23, 8, 4).getTime();
  const tomorrow = new Date(2026, 7, 24, 8, 3).getTime();
  const host = refreshHost(t, now);
  host.start();

  // When the user inspects the target and advances to its next occurrence
  host.menus.get('显示下一次自动刷新时间')();
  host.clock.tick(tomorrow - now - 1);
  assert.deepEqual(host.reloads, []);
  host.clock.tick(1);

  // Then the menu and actual reload agree on tomorrow's 08:03 target
  assert.deepEqual(host.alerts, [`下一次自动刷新: ${new Date(tomorrow).toLocaleString()}`]);
  assert.deepEqual(host.reloads, [tomorrow]);
});

test('user leaves nonmatching pages untouched even when invoking the scheduling menu', t => {
  // Given the installed script opens on a URL outside its exact console route
  const host = refreshHost(t, new Date(2026, 7, 23, 7).getTime(), 'https://anyrouter.top/other');
  host.start();

  // When the menu, focus, and visibility events occur across daily target times
  host.menus.get('立即重新计算并安排')();
  host.window.dispatchEvent(new Event('focus'));
  host.visibility(false);
  host.clock.tick(48 * 60 * 60 * 1_000);

  // Then no business timer or installed event listener requests a reload
  assert.deepEqual(host.reloads, []);
  assert.equal(host.menus.size, 2);
});

test('user receives no immediate refresh after leaving the matching route', t => {
  // Given the active console has scheduled a later daily refresh
  const now = new Date(2026, 7, 23, 7).getTime();
  const host = refreshHost(t, now);
  host.start();

  // When an SPA transition leaves the route before the periodic check occurs
  host.location.href = 'https://anyrouter.top/other';
  host.clock.tick(30_000);
  host.window.dispatchEvent(new Event('focus'));

  // Then the off-route periodic and focus handlers request no immediate reload
  assert.deepEqual(host.reloads, []);
  assert.equal(host.location.href, 'https://anyrouter.top/other');
});

test('user can leave the console before its deadline without reloading the new route', t => {
  // Given the console schedules a refresh one minute in the future
  const host = refreshHost(t, new Date(2026, 7, 23, 8, 2).getTime());
  host.start();

  // When an SPA route change remains outside the console through the original deadline
  host.location.href = 'https://anyrouter.top/other';
  host.clock.tick(60_000);

  // Then both the periodic check and scheduled deadline leave that route untouched
  assert.deepEqual(host.reloads, []);
  assert.equal(host.location.href, 'https://anyrouter.top/other');
});

test('user consumes a missed refresh once after returning to the console route', t => {
  // Given the console is left before its already scheduled deadline
  const now = new Date(2026, 7, 23, 8, 2).getTime();
  const host = refreshHost(t, now);
  host.start();
  host.location.href = 'https://anyrouter.top/other';
  host.clock.tick(60_000);
  assert.deepEqual(host.reloads, []);

  // When focus returns to the console thirty seconds after that missed deadline
  host.clock.tick(30_000);
  host.location.href = 'https://anyrouter.top/console';
  host.window.dispatchEvent(new Event('focus'));
  host.clock.tick(0);
  host.window.dispatchEvent(new Event('focus'));
  host.visibility(false);
  host.clock.tick(30_000);

  // Then the overdue target is consumed once despite later focus and periodic checks
  assert.deepEqual(host.reloads, [now + 90_000]);
  assert.equal(host.location.href, 'https://anyrouter.top/console');
});
