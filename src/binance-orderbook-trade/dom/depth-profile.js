export const DEPTH_PROFILE_ID = 'jh-binance-depth-profile';

const STYLE_ID = 'jh-binance-depth-profile-style';
const CHART_ROOT_SELECTOR = '.chart-widget-root';
const PRICE_AXIS_SELECTOR = '.chart-markup-table.price-axis-container';
const PRICE_COORDINATE_SEARCH_STEPS = 13;
const GEOMETRY_TOLERANCE_PX = 1;

function hasVisibleBox(element) {
  if (!element?.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findDepthProfileHost(document) {
  const chartRoots = Array.from(document.querySelectorAll(CHART_ROOT_SELECTOR))
    .filter(hasVisibleBox);
  if (!chartRoots.length) return null;
  if (chartRoots.length > 1) {
    throw new Error(`Visible chart root count is invalid: ${chartRoots.length}`);
  }
  const chartRoot = chartRoots[0];
  const frames = Array.from(chartRoot.querySelectorAll('iframe')).filter(hasVisibleBox);
  if (frames.length > 1) {
    throw new Error(`Visible chart frame count is invalid: ${frames.length}`);
  }
  if (!frames.length) return null;
  const frame = frames[0];
  const host = frame.parentElement?.parentElement;
  if (!host || !chartRoot.contains(host)) {
    throw new Error('Visible chart frame host is invalid');
  }
  return { chartRoot, frame, host };
}

export function getTradingViewDepthProfileGeometry(frame) {
  // Binance embeds a same-origin TradingView build. Keep this optional adapter isolated and
  // fail closed when its runtime contract changes instead of drawing against an invented scale.
  const chart = frame?.contentWindow?.tradingViewApi?.activeChart?.();
  if (!chart) return null;
  const paneHeights = chart.getAllPanesHeight?.();
  const panes = chart.getPanes?.();
  if (!Array.isArray(paneHeights) || !Array.isArray(panes) || !panes.length) return null;
  const height = Number(paneHeights[0]);
  const scale = panes[0]?.getMainSourcePriceScale?.();
  if (!(height > 0) || !scale) return null;
  if (
    typeof scale.coordinateToPrice !== 'function'
    || typeof scale.getVisiblePriceRange !== 'function'
    || typeof scale.getMode !== 'function'
    || typeof scale.isInverted !== 'function'
  ) return null;

  const viewportWidth = Number(frame.contentWindow.innerWidth);
  if (!Number.isFinite(viewportWidth) || !(viewportWidth > 0)) return null;
  const priceAxisRects = Array.from(
    frame.contentDocument.querySelectorAll(PRICE_AXIS_SELECTOR),
    (element) => element.getBoundingClientRect(),
  ).filter((rect) => (
    rect.width > 0
    && rect.height > 0
    && Math.abs(rect.top) <= GEOMETRY_TOLERANCE_PX
    && Math.abs(rect.height - height) <= GEOMETRY_TOLERANCE_PX
    && Math.abs(rect.right - viewportWidth) <= GEOMETRY_TOLERANCE_PX
  ));
  if (priceAxisRects.length !== 1) return null;
  const rightInset = Number(priceAxisRects[0].width);
  if (!Number.isFinite(rightInset) || !(rightInset > 0)) return null;

  const visibleRange = scale.getVisiblePriceRange();
  const mode = scale.getMode();
  const inverted = scale.isInverted();
  const sampledPrices = [0, height / 4, height / 2, height * 3 / 4, height]
    .map((coordinate) => Number(scale.coordinateToPrice(coordinate)));
  const [topPrice, , , , bottomPrice] = sampledPrices;
  if (
    !visibleRange
    || !Number.isFinite(Number(visibleRange.from))
    || !Number.isFinite(Number(visibleRange.to))
    || !Number.isInteger(mode)
    || typeof inverted !== 'boolean'
    || !Number.isFinite(topPrice)
    || !Number.isFinite(bottomPrice)
    || topPrice === bottomPrice
  ) return null;

  const minPrice = Math.min(topPrice, bottomPrice);
  const maxPrice = Math.max(topPrice, bottomPrice);
  const descendsWithY = topPrice > bottomPrice;
  if (sampledPrices.some((price, index) => (
    !Number.isFinite(price)
    || (index > 0 && (descendsWithY
      ? price >= sampledPrices[index - 1]
      : price <= sampledPrices[index - 1]))
  ))) return null;
  return {
    top: 0,
    height,
    rightInset,
    minPrice,
    maxPrice,
    mode,
    inverted,
    priceToCoordinate(price) {
      if (!Number.isFinite(price) || price < minPrice || price > maxPrice) return null;
      if (price === topPrice) return 0;
      if (price === bottomPrice) return height;
      let low = 0;
      let high = height;
      for (let index = 0; index < PRICE_COORDINATE_SEARCH_STEPS; index += 1) {
        const middle = (low + high) / 2;
        const middlePrice = Number(scale.coordinateToPrice(middle));
        if (!Number.isFinite(middlePrice)) {
          throw new Error('TradingView price coordinate is invalid');
        }
        if (descendsWithY ? middlePrice > price : middlePrice < price) low = middle;
        else high = middle;
      }
      return (low + high) / 2;
    },
  };
}

function installStyle(document) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${DEPTH_PROFILE_ID} {
      position: absolute;
      z-index: 3;
      top: 0;
      right: 0;
      bottom: auto;
      height: 0;
      width: 132px;
      overflow: visible;
      pointer-events: none;
      font-family: BinancePlex, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #${DEPTH_PROFILE_ID} .jh-depth-profile-canvas {
      display: block;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-BasicBg, #fff) 72%, transparent));
      opacity: .9;
      pointer-events: none;
    }
    #${DEPTH_PROFILE_ID}[data-expanded="false"] .jh-depth-profile-canvas {
      display: none;
    }
    #${DEPTH_PROFILE_ID} .jh-depth-profile-toggle {
      position: absolute;
      z-index: 2;
      top: 8px;
      right: 4px;
      box-sizing: border-box;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid var(--color-InputLine, #d8dce1);
      border-radius: 6px;
      background: color-mix(in srgb, var(--color-BasicBg, #fff) 88%, transparent);
      color: var(--color-SecondaryText, #474d57);
      font-size: 12px;
      line-height: 22px;
      text-align: center;
      cursor: pointer;
      pointer-events: auto;
    }
    #${DEPTH_PROFILE_ID}[data-expanded="false"] {
      width: 28px;
    }
    #${DEPTH_PROFILE_ID} .jh-depth-profile-status {
      position: absolute;
      right: 4px;
      bottom: 8px;
      max-width: 124px;
      padding: 3px 6px;
      overflow: hidden;
      border-radius: 4px;
      background: color-mix(in srgb, var(--color-BasicBg, #fff) 90%, transparent);
      color: var(--color-TertiaryText, #707a8a);
      font-size: 10px;
      line-height: 14px;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }
    #${DEPTH_PROFILE_ID} .jh-depth-profile-status:empty,
    #${DEPTH_PROFILE_ID}[data-expanded="false"] .jh-depth-profile-status {
      display: none;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

export function ensureDepthProfileView(document, host, { onToggle }) {
  if (!(host instanceof document.defaultView.Element)) {
    throw new Error('Invalid depth profile host');
  }
  if (typeof onToggle !== 'function') throw new Error('Invalid depth profile toggle listener');
  const existing = document.getElementById(DEPTH_PROFILE_ID);
  if (existing && existing.parentElement === host) return existing;
  existing?.remove();
  installStyle(document);

  const root = document.createElement('div');
  root.id = DEPTH_PROFILE_ID;
  root.dataset.expanded = 'true';

  const canvas = document.createElement('canvas');
  canvas.className = 'jh-depth-profile-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  root.appendChild(canvas);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'jh-depth-profile-toggle';
  toggle.dataset.depthProfileToggle = 'true';
  toggle.addEventListener('click', onToggle);
  root.appendChild(toggle);

  const status = document.createElement('div');
  status.className = 'jh-depth-profile-status';
  status.setAttribute('aria-live', 'polite');
  root.appendChild(status);

  host.appendChild(root);
  return root;
}

export function setDepthProfileViewState(root, {
  expanded,
  expandedLabel,
  collapsedLabel,
  status = '',
  statusTitle = status,
}) {
  const toggle = root.querySelector('[data-depth-profile-toggle]');
  const statusElement = root.querySelector('.jh-depth-profile-status');
  const expandedValue = String(expanded);
  const toggleText = expanded ? '−' : collapsedLabel;
  const toggleTitle = expanded ? expandedLabel : collapsedLabel;
  if (root.dataset.expanded !== expandedValue) root.dataset.expanded = expandedValue;
  if (toggle.textContent !== toggleText) toggle.textContent = toggleText;
  if (toggle.title !== toggleTitle) toggle.title = toggleTitle;
  if (toggle.getAttribute('aria-label') !== toggleTitle) {
    toggle.setAttribute('aria-label', toggleTitle);
  }
  if (toggle.getAttribute('aria-pressed') !== expandedValue) {
    toggle.setAttribute('aria-pressed', expandedValue);
  }
  if (statusElement.textContent !== status) statusElement.textContent = status;
  if (statusElement.title !== statusTitle) statusElement.title = statusTitle;
}

export function setDepthProfileGeometry(root, geometry) {
  const top = `${geometry.top}px`;
  const height = `${geometry.height}px`;
  const right = `${geometry.rightInset}px`;
  if (root.style.top !== top) root.style.top = top;
  if (root.style.height !== height) root.style.height = height;
  if (root.style.right !== right) root.style.right = right;
}

function bucketVisibleLevels(levels, geometry) {
  const lastRow = Math.max(0, Math.ceil(geometry.height) - 1);
  const buckets = new Map();
  for (const level of levels) {
    const coordinate = geometry.priceToCoordinate(level.price);
    if (!Number.isFinite(coordinate)) continue;
    const y = Math.max(0, Math.min(lastRow, Math.round(coordinate)));
    const current = buckets.get(y);
    // Several exchange prices can map to one chart pixel. The outermost level has the
    // largest cumulative quantity and preserves the complete depth represented by that row.
    if (!current || level.cumulative > current.cumulative) {
      buckets.set(y, { ...level, y });
    }
  }
  return [...buckets.values()].sort((left, right) => left.y - right.y);
}

function drawSide(context, levels, maxVisibleCumulative, width, color) {
  if (!levels.length) return;
  context.fillStyle = color;
  for (const level of levels) {
    const barWidth = (level.cumulative / maxVisibleCumulative) * width;
    context.fillRect(width - barWidth, level.y, barWidth, 1);
  }
}

function getMaxVisibleCumulative(...levelGroups) {
  let maximum = 0;
  for (const levels of levelGroups) {
    for (const level of levels) maximum = Math.max(maximum, level.cumulative);
  }
  return maximum;
}

export function renderDepthProfile(root, profile, geometry, currentPrice) {
  setDepthProfileGeometry(root, geometry);
  const canvas = root.querySelector('.jh-depth-profile-canvas');
  const rect = canvas.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return false;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Depth profile canvas context is unavailable');
  const devicePixelRatio = root.ownerDocument.defaultView.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(rect.width * devicePixelRatio));
  const pixelHeight = Math.max(1, Math.round(rect.height * devicePixelRatio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const asks = bucketVisibleLevels(profile.asks, geometry);
  const bids = bucketVisibleLevels(profile.bids, geometry);
  const maxVisibleCumulative = getMaxVisibleCumulative(asks, bids);
  if (maxVisibleCumulative > 0) {
    drawSide(context, asks, maxVisibleCumulative, rect.width, 'rgba(246, 70, 93, .30)');
    drawSide(context, bids, maxVisibleCumulative, rect.width, 'rgba(14, 203, 129, .30)');
  }

  const currentPriceY = geometry.priceToCoordinate(currentPrice);
  if (!Number.isFinite(currentPriceY)) return true;
  context.save();
  context.strokeStyle = 'rgba(240, 185, 11, .85)';
  context.lineWidth = 1;
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(0, currentPriceY + 0.5);
  context.lineTo(rect.width, currentPriceY + 0.5);
  context.stroke();
  context.restore();
  return true;
}

export function clearDepthProfile(root) {
  const canvas = root.querySelector('.jh-depth-profile-canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Depth profile canvas context is unavailable');
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();
}

export function removeDepthProfileView(document) {
  document.getElementById(DEPTH_PROFILE_ID)?.remove();
}
