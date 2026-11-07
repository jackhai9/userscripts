import assert from 'node:assert/strict';

/** Explicit layout deliveries for JSDOM; native delivery semantics are checked in strategy29-panel-resize.pw.js. */
export function installPanelResizeObserverHost(view) {
  const observers = [];
  view.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      observers.push(this);
    }
    observe(target, options) {
      assert.equal(options.box, 'border-box');
      this.targets.add(target);
    }
    disconnect() { this.targets.clear(); }
  };
  return {
    observers,
    deliver(target) {
      for (const observer of observers) {
        if (observer.targets.has(target)) observer.callback([{ target }], observer);
      }
    },
    get activeTargets() { return observers.reduce((count, observer) => count + observer.targets.size, 0); },
  };
}
