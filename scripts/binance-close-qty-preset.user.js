// ==UserScript==
// @name         【自写】Binance 平仓数量档位切换
// @namespace    binance.close.qty.preset
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      1.0.0
// @author       jackhai9
// @description  用 [ 和 ] 快捷键切换 Binance 合约页的平仓数量档位，并在页面显示当前档位
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-qty-preset.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-qty-preset.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'jh_binance_close_qty_preset';
  const PRESETS = ['0.003', '0.007', '0.056', '0.098'];
  const PREV_KEY = '[';
  const NEXT_KEY = ']';
  const BADGE_ID = 'jh-binance-close-qty-preset-badge';

  function isEditableTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function loadPreset() {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value && PRESETS.includes(value)) return value;
    return PRESETS[0];
  }

  function savePreset(value) {
    localStorage.setItem(STORAGE_KEY, value);
  }

  function ensureBadge() {
    let badge = document.getElementById(BADGE_ID);
    if (badge) return badge;

    badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.style.position = 'fixed';
    badge.style.right = '16px';
    badge.style.bottom = '88px';
    badge.style.zIndex = '999999';
    badge.style.padding = '6px 10px';
    badge.style.borderRadius = '10px';
    badge.style.background = 'rgba(15, 23, 42, 0.88)';
    badge.style.color = '#f8fafc';
    badge.style.fontSize = '12px';
    badge.style.lineHeight = '16px';
    badge.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    badge.style.boxShadow = '0 6px 18px rgba(15, 23, 42, 0.22)';
    badge.style.userSelect = 'none';
    badge.style.pointerEvents = 'none';
    document.body.appendChild(badge);
    return badge;
  }

  function renderBadge() {
    const badge = ensureBadge();
    const current = loadPreset();
    badge.textContent = `平仓数量档位 ${current}  [ ]`;
  }

  function switchPreset(direction) {
    const current = loadPreset();
    const idx = PRESETS.indexOf(current);
    const nextIdx = (idx + direction + PRESETS.length) % PRESETS.length;
    const nextValue = PRESETS[nextIdx];
    savePreset(nextValue);
    renderBadge();
  }

  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    if (isEditableTarget(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === PREV_KEY) {
      event.preventDefault();
      switchPreset(-1);
      return;
    }
    if (event.key === NEXT_KEY) {
      event.preventDefault();
      switchPreset(1);
    }
  }, true);

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) renderBadge();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderBadge, { once: true });
  } else {
    renderBadge();
  }
})();
