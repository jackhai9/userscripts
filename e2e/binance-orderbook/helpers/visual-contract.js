function round(value) {
  return Math.round(value * 10) / 10;
}

export async function readPanelVisualContract(page) {
  return page.locator('#jh-binance-close-qty-multiplier-panel').evaluate((panel) => {
    const rootRect = panel.getBoundingClientRect();
    const relativeRect = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round((rect.top - rootRect.top) * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      };
    };
    const styleContract = (element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        opacity: style.opacity,
      };
    };
    const controlKey = (element, index) => (
      element.id
      || element.getAttribute('data-ladder-action')
      || element.getAttribute('data-ladder-stop')
      || element.getAttribute('data-ladder-cancel-symbol')
      || element.getAttribute('data-orderbook-precision-value')
      || `${element.getAttribute('data-ladder-group') || 'control'}:${element.getAttribute('data-ladder-value') || index}`
    );
    const controls = Array.from(panel.querySelectorAll([
      '[data-side-selector] button',
      '#jh-binance-close-qty-multiplier-input',
      '#jh-binance-close-qty-multiplier-dec',
      '#jh-binance-close-qty-multiplier-inc',
      '[data-orderbook-precision-value]',
      '[data-ladder-group]',
      '[data-ladder-action]',
      '[data-ladder-stop]',
      '[data-ladder-cancel-symbol]',
    ].join(','))).map((element, index) => ({
      key: controlKey(element, index),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
      disabled: element.matches(':disabled'),
      checked: element.getAttribute('aria-checked'),
      pressed: element.getAttribute('aria-pressed'),
      rect: relativeRect(element),
      style: styleContract(element),
    }));
    const groups = Object.fromEntries(
      Array.from(panel.querySelectorAll('[data-panel-group]')).map((element) => [
        element.getAttribute('data-panel-group'),
        {
          rect: relativeRect(element),
          display: getComputedStyle(element).display,
          visibility: getComputedStyle(element).visibility,
        },
      ])
    );
    return {
      panel: {
        width: Math.round(rootRect.width * 10) / 10,
        height: Math.round(rootRect.height * 10) / 10,
        padding: getComputedStyle(panel).padding,
        borderRadius: getComputedStyle(panel).borderRadius,
      },
      groups,
      controls,
      text: {
        mode: panel.querySelector('#jh-binance-trade-mode-hint')?.textContent || '',
        formula: panel.querySelector('[data-multiplier-calculation]')?.textContent || '',
        precision: panel.querySelector('[data-panel-group="precision"]')?.textContent || '',
        status: panel.querySelector('#jh-binance-ladder-status')?.textContent || '',
      },
    };
  }).then((contract) => JSON.parse(JSON.stringify(contract), (_, value) => (
    typeof value === 'number' ? round(value) : value
  )));
}
