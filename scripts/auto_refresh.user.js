// ==UserScript==
// @name         【自写】定时刷新指定页面
// @namespace    daily-0805-refresh
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      1.0.6
// @author       jackhai9
// @description  ⚠️ 暂不推荐此方式，已改为 macOS launchd + AppleScript 定时打开页面，请参考 https://github.com/jackhai9/dotfiles 中的 home-configs/.local/bin/anyrouter-checkin.sh
// @match        https://anyrouter.top/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/auto_refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/auto_refresh.user.js
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* 配置区 */
  const TARGET_HOUR = 8;
  const TARGET_MINUTE = 3;

  // 只在命中这些页面时启用。把这里改成你的目标页面规则。
  // 例子：const ENABLE_WHEN = (url) => url.startsWith('https://example.com/some/page');
  const ENABLE_WHEN = (url) => url === 'https://anyrouter.top/console';

  const CHECK_EVERY_MS = 30 * 1000;
  const DEBUG = false;

  function log(...args) {
    if (DEBUG) console.log('[TM-08:05]', ...args);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function computeNextTarget(fromTs) {
    const d = new Date(fromTs);
    const next = new Date(d.getTime());
    next.setSeconds(0, 0);
    next.setHours(TARGET_HOUR, TARGET_MINUTE, 0, 0);

    if (next.getTime() <= fromTs) {
      next.setDate(next.getDate() + 1);
      next.setHours(TARGET_HOUR, TARGET_MINUTE, 0, 0);
    }
    return next;
  }

  function schedule() {
    if (!ENABLE_WHEN(location.href)) {
      log('Not enabled for this URL:', location.href);
      return;
    }

    const now = Date.now();
    const next = computeNextTarget(now);
    const delay = next.getTime() - now;

    log('Next refresh at:', next.toString(), 'delay(ms):', delay);

    if (schedule._t) clearTimeout(schedule._t);
    schedule._t = setTimeout(() => {
      location.reload();
    }, delay);
  }

  function periodicCheck() {
    if (!ENABLE_WHEN(location.href)) return;

    const now = Date.now();
    const next = computeNextTarget(now);
    const remaining = next.getTime() - now;

    if (remaining <= 1000) {
      location.reload();
      return;
    }
  }

  GM_registerMenuCommand('显示下一次自动刷新时间', () => {
    const next = computeNextTarget(Date.now());
    alert(`下一次自动刷新: ${next.toLocaleString()}`);
  });

  GM_registerMenuCommand('立即重新计算并安排', () => {
    schedule();
    alert('已重新安排');
  });

  if (!ENABLE_WHEN(location.href)) return;

  schedule();
  setInterval(periodicCheck, CHECK_EVERY_MS);

  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule();
  });

  console.log(
    `[TM-08:05] 已启用 每天 ${pad2(TARGET_HOUR)}:${pad2(TARGET_MINUTE)} 自动刷新 当前页:`,
    location.href
  );
})();
