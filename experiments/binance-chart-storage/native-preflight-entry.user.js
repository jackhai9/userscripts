// ==UserScript==
// @name         Binance Chart Mirror Native Preflight (Experiment)
// @namespace    binance.chart.mirror.native-preflight
// @version      0.0.1
// @description  Observe pinned mirror startup and native dispatch counts without custom storage writes.
// @match        https://www.binance.com/zh-CN/futures/USUSDT
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==

import { startNativeMirrorPreflight } from './native-preflight-core.js';

(function installNativeMirrorPreflight() {
  if (Object.hasOwn(self, '__BINANCE_MIRROR_PREFLIGHT__')) return;
  const { snapshot, stop } = startNativeMirrorPreflight();
  Object.defineProperty(self, '__BINANCE_MIRROR_PREFLIGHT__', {
    value: Object.freeze({ snapshot, stop }), configurable: true,
  });
})();
