export const BINANCE_CHART_IFRAME_SELECTOR =
  '#chart_futures-tradingview > iframe[id^="tradingview_"]';

const CHART_PANEL_SELECTOR = '.bn-flex.h-full.flex-col';
const CHART_TOOLBAR_SELECTOR = '.flex.items-center.gap-\\[--space-m\\]';
const ACTIVE_POPOVER_SELECTOR = '.bn-bubble.active';
const OPEN_ORDERS_LABEL_PATTERN = /^(?:当前委托|Open Orders)$/i;

function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function findBinanceChartOrdersTarget(document) {
  const frames = Array.from(document.querySelectorAll(BINANCE_CHART_IFRAME_SELECTOR));
  if (!frames.length) return null;
  if (frames.length > 1) {
    throw new Error(`Expected one Binance chart iframe, found ${frames.length}`);
  }

  const frame = frames[0];
  const chartRoot = frame.closest('.chart-widget-root');
  if (!chartRoot) return null;

  const panels = Array.from(chartRoot.querySelectorAll(CHART_PANEL_SELECTOR))
    .filter((panel) => panel.children.length >= 2 && panel.children[1].contains(frame));
  if (!panels.length) return null;
  if (panels.length > 1) {
    throw new Error(`Expected one Binance chart panel, found ${panels.length}`);
  }

  const panel = panels[0];
  const header = panel.children[0];
  const toolbars = Array.from(header.querySelectorAll(CHART_TOOLBAR_SELECTOR))
    .filter((toolbar) => {
      if (toolbar.children.length < 2) return false;
      const trigger = toolbar.children[toolbar.children.length - 2];
      const latestPriceSlot = toolbar.children[toolbar.children.length - 1];
      return trigger.matches('.bn-tooltips-wrap.bn-tooltips-web')
        && latestPriceSlot.matches('.contents');
    });
  if (!toolbars.length) return null;
  if (toolbars.length > 1) {
    throw new Error(`Expected one Binance chart toolbar, found ${toolbars.length}`);
  }

  const toolbar = toolbars[0];
  const trigger = toolbar.children[toolbar.children.length - 2];
  if (!trigger) throw new Error('Binance chart orders menu trigger is unavailable');
  return { frame, chartRoot, trigger };
}

export function getBinanceChartOrdersTarget(document) {
  const target = findBinanceChartOrdersTarget(document);
  if (!target) throw new Error('Binance chart orders target is unavailable');
  return target;
}

export function assertSameBinanceChartOrdersTarget(capturedTarget, currentTarget) {
  if (!capturedTarget || !currentTarget) {
    throw new Error('Binance chart orders target is unavailable');
  }
  if (
    capturedTarget.frame !== currentTarget.frame
    || capturedTarget.chartRoot !== currentTarget.chartRoot
  ) {
    throw new Error('Binance chart orders target changed');
  }
}

export function findActiveBinanceChartOrdersPopover(document, isVisibleElement) {
  const candidates = Array.from(document.querySelectorAll(ACTIVE_POPOVER_SELECTOR))
    .filter(isVisibleElement)
    .map((popover) => {
      const checkboxes = Array.from(popover.querySelectorAll('[role="checkbox"]'))
        .filter(isVisibleElement);
      if (checkboxes.length !== 8) return null;

      const checkbox = checkboxes[1];
      const label = normalizeLabel(checkbox.textContent);
      if (!OPEN_ORDERS_LABEL_PATTERN.test(label)) return null;

      const checkedValue = checkbox.getAttribute('aria-checked');
      if (checkedValue !== 'true' && checkedValue !== 'false') {
        throw new Error(`Binance chart OpenOrders state is ${checkedValue}`);
      }
      return { popover, checkbox, checked: checkedValue === 'true' };
    })
    .filter(Boolean);

  if (candidates.length > 1) {
    throw new Error(`Expected at most one Binance chart OpenOrders popover, found ${candidates.length}`);
  }
  return candidates[0] || null;
}
