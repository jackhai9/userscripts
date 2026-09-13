import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from './userscript-page.js';

export const DEPTH_PROFILE_SELECTOR = '#jh-binance-depth-profile';
export const DEPTH_LABEL_SYMBOL = 'LSKUSDT';
export const DEPTH_LABEL_LEVELS = {
  asks: [
    ['1.55', '5000'],
    ['1.7', '8000'],
    ['1.7003', '12000'],
    ['1.8', '3800000'],
    ['2', '2400000'],
  ],
  bids: [['1.49', '12000'], ['1.45', '8000'], ['1.3', '620000']],
};

/** Observe only the final userscript canvas frame; native drawing still runs. */
function installDepthLabelProbe() {
  const state = {
    drawing: { serial: 0, rectangles: [], texts: [] },
    socketCount: 0,
    chartClicks: 0,
    chartReady: false,
    updateId: 102,
  };
  window.__DEPTH_LABEL_FIXTURE__ = state;
  const prototype = CanvasRenderingContext2D.prototype;
  const belongsToDepthProfile = (context) => (
    context.canvas.matches('#jh-binance-depth-profile .jh-depth-profile-canvas')
  );
  const originalClear = prototype.clearRect;
  prototype.clearRect = function (...args) {
    const result = Reflect.apply(originalClear, this, args);
    if (belongsToDepthProfile(this)) {
      state.drawing = { serial: state.drawing.serial + 1, rectangles: [], texts: [] };
    }
    return result;
  };
  const originalFillRect = prototype.fillRect;
  prototype.fillRect = function (x, y, width, height) {
    const result = Reflect.apply(originalFillRect, this, [x, y, width, height]);
    if (belongsToDepthProfile(this)) {
      state.drawing.rectangles.push({ x, y, width, height, fillStyle: this.fillStyle });
    }
    return result;
  };
  const originalFillText = prototype.fillText;
  prototype.fillText = function (...args) {
    const result = Reflect.apply(originalFillText, this, args);
    if (belongsToDepthProfile(this)) {
      const [text, x, y] = args;
      state.drawing.texts.push({
        text, x, y,
        width: this.measureText(text).width,
        font: this.font,
        fillStyle: this.fillStyle,
      });
    }
    return result;
  };

  // The generated native adapter observes this page-owned socket without networking.
  window.WebSocket = class extends EventTarget {
    constructor() {
      super();
      state.socketCount += 1;
    }
  };
}

function readChartLayoutInPage() {
  const chart = document.querySelector('.chart-widget-root');
  const frame = chart.querySelector('iframe');
  const axis = frame.contentDocument.querySelector('.chart-markup-table.price-axis-container');
  const box = (element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  return { chart: box(chart), frame: box(frame), axis: box(axis) };
}

export async function readDepthChartLayout(page) {
  return page.evaluate(readChartLayoutInPage);
}

export async function readDepthDrawing(page) {
  return page.evaluate(() => window.__DEPTH_LABEL_FIXTURE__.drawing);
}

/**
 * Mount a local TradingView geometry contract and feed the generated userscript's
 * real native-depth adapter. Returned state and the chart locator also support
 * screenshot inspection without any production connection.
 */
export async function openDepthLabelScenario(page, {
  levels = DEPTH_LABEL_LEVELS,
  currentPrice = 1.5,
} = {}) {
  await page.route('**/*', (route) => route.abort('blockedbyclient'));
  const evidence = await openUserscriptScenario(page, createCancelScenario({
    name: 'depth-profile-compact-labels',
    currentSymbol: DEPTH_LABEL_SYMBOL,
  }), {
    beforeOrderbook: `(${installDepthLabelProbe.toString()})();`,
  });
  const snapshotRequests = [];
  await page.route('https://www.binance.com/fapi/v1/rpiDepth**', async (route) => {
    const url = new URL(route.request().url());
    snapshotRequests.push({
      symbol: url.searchParams.get('symbol'),
      limit: url.searchParams.get('limit'),
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lastUpdateId: 101, ...levels }),
    });
  });

  await page.evaluate(async ({ currentPrice, symbol }) => {
    const previousFrame = document.querySelector('.chart-widget-root iframe');
    const chartApi = previousFrame.contentWindow.tradingViewApi;
    const host = document.createElement('div');
    host.id = 'depth-chart-fixture-host';
    host.style.cssText = 'position:relative;height:260px';
    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';
    const frame = document.createElement('iframe');
    frame.title = 'TradingView depth label fixture';
    frame.srcdoc = `<!doctype html><html><head><style>
      html, body { margin: 0; height: 100%; font: 11px Arial, sans-serif; color: #707a8a; }
      #depth-chart-surface { position: absolute; inset: 0 60px 0 0; border: 0; padding: 12px;
        background: repeating-linear-gradient(to bottom, #fff 0 51px, #f0f1f2 51px 52px);
        color: #707a8a; text-align: left; cursor: crosshair; }
      #depth-chart-surface span { position: absolute; top: 12px; left: 12px; }
      .price-axis-container { position: absolute; top: 0; right: 0; width: 60px; height: 260px;
        border-left: 1px solid #eaecef; box-sizing: border-box; background: #fff; }
      .price-axis-container span { position: absolute; left: 8px; }
    </style></head><body>
      <button id="depth-chart-surface" aria-label="Chart interaction surface"><span></span></button>
      <div class="chart-markup-table price-axis-container">
        <span style="top:0">2.2</span><span style="top:46px">2.0</span>
        <span style="top:98px">1.8</span><span style="top:150px">1.6</span>
        <span style="top:202px">1.4</span><span style="bottom:0">1.2</span>
      </div>
    </body></html>`;
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    wrapper.append(frame);
    host.append(wrapper);
    previousFrame.replaceWith(host);
    await loaded;
    const surface = frame.contentDocument.querySelector('#depth-chart-surface');
    surface.querySelector('span').textContent = `${symbol} · Local depth fixture`;
    surface.addEventListener('click', () => { window.__DEPTH_LABEL_FIXTURE__.chartClicks += 1; });
    const tradeList = document.querySelector('.tradew-tradelist');
    tradeList.querySelectorAll('.price.emit-price').forEach((node) => {
      node.textContent = currentPrice === null ? '—' : String(currentPrice);
    });
    const scale = {
      coordinateToPrice: (y) => 2.2 - y / 260,
      getVisiblePriceRange: () => ({ from: 1.2, to: 2.2 }),
      getMode: () => 0,
      isInverted: () => false,
    };
    frame.contentWindow.tradingViewApi = {
      ...chartApi,
      activeChart: () => ({
        hasModel: () => window.__DEPTH_LABEL_FIXTURE__.chartReady,
        getAllPanesHeight: () => [260],
        getPanes: () => [{ getMainSourcePriceScale: () => scale }],
      }),
    };
  }, { currentPrice, symbol: DEPTH_LABEL_SYMBOL });
  const initialLayout = await readDepthChartLayout(page);
  await page.evaluate(() => {
    window.__DEPTH_LABEL_FIXTURE__.chartReady = true;
    window.dispatchEvent(new Event('resize'));
  });
  await page.locator(`${DEPTH_PROFILE_SELECTOR} canvas`).waitFor({ state: 'visible' });

  await page.evaluate(async (symbol) => {
    const state = window.__DEPTH_LABEL_FIXTURE__;
    state.socket = new WebSocket('wss://depth-label-fixture.invalid/ws');
    const response = fetch(`/fapi/v1/rpiDepth?${new URLSearchParams({ symbol, limit: '1000' })}`);
    state.socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      stream: `${symbol.toLowerCase()}@rpiDepth@500ms`,
      data: { e: 'depthUpdate', s: symbol, st: 1, U: 100, u: 102, pu: 99, b: [], a: [] },
    }) }));
    await (await response).json();
  }, DEPTH_LABEL_SYMBOL);
  await page.waitForFunction(() => (
    window.__TM_CLOSE_LONG_DEBUG__.nativeDepthState.status.status === 'ready'
  ));
  return { ...evidence, snapshotRequests, initialLayout };
}

export async function emitDepthLabelUpdate(page, { asks, bids }) {
  await page.evaluate(({ asks, bids, symbol }) => {
    const state = window.__DEPTH_LABEL_FIXTURE__;
    const previousUpdateId = state.updateId;
    state.updateId += 1;
    state.socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      stream: `${symbol.toLowerCase()}@rpiDepth@500ms`,
      data: {
        e: 'depthUpdate', s: symbol, st: 1,
        U: state.updateId, u: state.updateId, pu: previousUpdateId,
        b: bids, a: asks,
      },
    }) }));
  }, { asks, bids, symbol: DEPTH_LABEL_SYMBOL });
}
