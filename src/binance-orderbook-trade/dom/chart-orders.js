import { findBinanceTradingViewTarget } from './tradingview-target.js';

const ACTIVE_POPOVER_SELECTOR = '.bn-bubble.active';
const OPEN_ORDERS_LABEL_PATTERN = /^(?:当前委托|Open Orders)$/i;
const LATEST_PRICE_CONTROL_SELECTOR =
  '.bn-tooltips-wrap.bn-tooltips-web.w-full.cursor-pointer';

function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasVisibleBox(element) {
  if (!element?.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findBinanceChartOrdersTarget(document) {
  const tradingViewTarget = findBinanceTradingViewTarget(document);
  if (!tradingViewTarget) return null;

  const { chartRoot, tradingViewApi } = tradingViewTarget;
  const toolbars = Array.from(chartRoot.querySelectorAll('.flex.items-center'))
    .filter((toolbar) => {
      if (toolbar.children.length < 2) return false;
      const trigger = toolbar.children[toolbar.children.length - 2];
      const latestPriceSlot = toolbar.children[toolbar.children.length - 1];
      const latestPriceControl = latestPriceSlot.matches(LATEST_PRICE_CONTROL_SELECTOR)
        ? latestPriceSlot
        : Array.from(latestPriceSlot.children)
          .find((child) => child.matches(LATEST_PRICE_CONTROL_SELECTOR));
      return hasVisibleBox(toolbar)
        && hasVisibleBox(trigger)
        && trigger.matches('.bn-tooltips-wrap.bn-tooltips-web')
        && hasVisibleBox(latestPriceControl);
    });
  if (!toolbars.length) return null;
  if (toolbars.length > 1) {
    throw new Error(`图表工具栏数量异常：${toolbars.length}`);
  }

  const toolbar = toolbars[0];
  const trigger = toolbar.children[toolbar.children.length - 2];
  const popoverReferences = Array.from(
    trigger.querySelectorAll('.bn-tooltips-ele[aria-describedby]'),
  );
  if (popoverReferences.length !== 1) {
    throw new Error(`图表“显示当前委托”菜单入口数量异常：${popoverReferences.length}`);
  }
  const popoverId = popoverReferences[0].getAttribute('aria-describedby');
  if (!popoverId) throw new Error('图表“显示当前委托”菜单标识缺失');

  return {
    chartRoot,
    tradingViewApi,
    toolbar,
    trigger,
    popoverId,
  };
}

export function getBinanceChartOrdersTarget(document) {
  const target = findBinanceChartOrdersTarget(document);
  if (!target) throw new Error('未找到图表“显示当前委托”控件');
  return target;
}

export function assertSameBinanceChartOrdersTarget(capturedTarget, currentTarget) {
  if (!capturedTarget || !currentTarget) {
    throw new Error('未找到图表“显示当前委托”控件');
  }
  if (
    capturedTarget.chartRoot !== currentTarget.chartRoot
    || capturedTarget.tradingViewApi !== currentTarget.tradingViewApi
    || capturedTarget.toolbar !== currentTarget.toolbar
    || capturedTarget.trigger !== currentTarget.trigger
    || capturedTarget.popoverId !== currentTarget.popoverId
  ) {
    throw new Error('图表“显示当前委托”控件已变化');
  }
}

export function findActiveBinanceChartOrdersPopover(
  document,
  target,
  isVisibleElement,
) {
  if (!target?.popoverId) throw new Error('未找到图表“显示当前委托”控件');
  const popover = document.getElementById(target.popoverId);
  if (
    !popover
    || !popover.matches(ACTIVE_POPOVER_SELECTOR)
    || !isVisibleElement(popover)
  ) {
    return null;
  }

  const checkboxes = Array.from(popover.querySelectorAll('[role="checkbox"]'))
    .filter(isVisibleElement)
    .filter((checkbox) => OPEN_ORDERS_LABEL_PATTERN.test(normalizeLabel(checkbox.textContent)));
  if (!checkboxes.length) return null;
  if (checkboxes.length > 1) {
    throw new Error(`图表“显示当前委托”选项数量异常：${checkboxes.length}`);
  }

  const checkbox = checkboxes[0];
  const checkedValue = checkbox.getAttribute('aria-checked');
  if (checkedValue !== 'true' && checkedValue !== 'false') {
    throw new Error(`图表“显示当前委托”状态异常：${checkedValue}`);
  }
  return { popover, checkbox, checked: checkedValue === 'true' };
}
