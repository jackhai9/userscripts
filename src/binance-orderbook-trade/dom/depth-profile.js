export const DEPTH_PROFILE_ID = 'jh-binance-depth-profile';

const STYLE_ID = 'jh-binance-depth-profile-style';
const CHART_ROOT_SELECTOR = '.chart-widget-root';

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
  if (frames.length === 1) {
    const frame = frames[0];
    const host = frame.parentElement?.parentElement;
    if (!host || !chartRoot.contains(host)) {
      throw new Error('Visible chart frame host is invalid');
    }
    return { chartRoot, frame, host };
  }

  const basicChartHosts = Array.from(
    chartRoot.querySelectorAll('.draggableCancel.h-full.relative'),
  ).filter((candidate) => (
    hasVisibleBox(candidate)
    && Array.from(candidate.querySelectorAll('.kline-container')).some(hasVisibleBox)
    && Array.from(candidate.querySelectorAll('canvas')).some(hasVisibleBox)
  ));
  if (basicChartHosts.length > 1) {
    throw new Error(`Visible basic chart host count is invalid: ${basicChartHosts.length}`);
  }
  if (!basicChartHosts.length) return null;
  return { chartRoot, frame: null, host: basicChartHosts[0] };
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
      right: 72px;
      bottom: 0;
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

function drawSide(context, levels, profile, width, height, color) {
  const priceRange = profile.maxPrice - profile.minPrice;
  const levelHeight = Math.max(1, Math.min(5, height / (levels.length * 2.4)));
  context.fillStyle = color;
  for (const level of levels) {
    const y = ((profile.maxPrice - level.price) / priceRange) * height;
    const barWidth = (level.cumulative / profile.maxCumulative) * width;
    context.fillRect(width - barWidth, y - levelHeight / 2, barWidth, levelHeight);
  }
}

export function renderDepthProfile(root, profile) {
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
  drawSide(context, profile.asks, profile, rect.width, rect.height, 'rgba(246, 70, 93, .30)');
  drawSide(context, profile.bids, profile, rect.width, rect.height, 'rgba(14, 203, 129, .30)');

  const priceRange = profile.maxPrice - profile.minPrice;
  const midY = ((profile.maxPrice - profile.midPrice) / priceRange) * rect.height;
  context.save();
  context.strokeStyle = 'rgba(240, 185, 11, .85)';
  context.lineWidth = 1;
  context.setLineDash([3, 3]);
  context.beginPath();
  context.moveTo(0, midY + 0.5);
  context.lineTo(rect.width, midY + 0.5);
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
