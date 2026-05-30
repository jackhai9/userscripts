import { JSDOM } from 'jsdom';

export function loadFixtureDom(html) {
  const dom = new JSDOM(html);
  const { window } = dom;

  window.HTMLElement.prototype.getClientRects = function getClientRects() {
    return this.hasAttribute('data-hidden') ? [] : [{ width: 100, height: 24 }];
  };
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return this.hasAttribute('data-hidden')
      ? { width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 }
      : { width: 100, height: 24, left: 0, right: 100, top: 0, bottom: 24 };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return this.hasAttribute('data-hidden') ? 0 : 100;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.hasAttribute('data-hidden') ? 0 : 24;
    },
  });

  return dom;
}

export function isVisibleElement(el) {
  return !!(el && el.getClientRects().length && (el.offsetWidth || el.offsetHeight));
}
