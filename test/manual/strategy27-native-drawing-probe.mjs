import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

// Inspect drawing capabilities in a disposable official demo, never in an
// authenticated Binance session. Results are not Binance loaded-source proof.
const output = await mkdtemp(join(tmpdir(), 'strategy27-native-drawing-'));
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const placementSource = await readFile(new URL('../../src/binance-strategy27-events/dom/tradingview-event-layer.js', import.meta.url), 'utf8');
const compoundSource = await readFile(new URL('../../src/binance-strategy27-events/dom/tradingview-compound-layer.js', import.meta.url), 'utf8');
const compoundUrl = moduleUrl(compoundSource.replace("'./tradingview-event-layer.js'", JSON.stringify(moduleUrl(placementSource))));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto('https://charting-library.tradingview-widget.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.evaluate(() => Promise.race([
    new Promise((resolve) => window.tvWidget.onChartReady(resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Demo chart readiness deadline exceeded')), 15000)),
  ]));
  const facts = await page.evaluate(async (url) => {
    const { createTradingViewCompoundLayer } = await import(url);
    const chart = window.tvWidget.activeChart();
    const data = chart.getSeries().data();
    const last = data.last().index;
    const model = chart._chartWidget.model().model();
    const mainSeries = model.mainSeries();
    const scale = mainSeries.priceScale();
    const firstValue = mainSeries.firstValue();
    const sentinel = await chart.createShape({ time: data.valueAt(last - 15)[0], price: data.valueAt(last - 15)[2] }, {
      shape: 'arrow_down', overrides: { arrowColor: '#F6465D' }, disableSave: true,
    });
    const baseline = new Set(chart.getAllShapes().map((shape) => shape.id));
    const layer = createTradingViewCompoundLayer({ chart }, { maxCandidates: 80 });
    const placements = [];
    for (const [id, offset, direction] of [
      ['impact-high', 45, 'high'],
      ['passive-high', 45, 'high'],
      ['impact-low', 85, 'low'],
      ['passive-low', 85, 'low'],
    ]) {
      const index = last - offset;
      const bar = data.valueAt(index);
      const candleEdge = direction === 'high' ? bar[2] : bar[3];
      const edgeY = scale.priceToCoordinate(candleEdge, firstValue);
      const rendered = await layer.renderCandidate(id, {
        markerTime: bar[0], markerShape: direction === 'high' ? 'arrow_down' : 'arrow_up',
        markerLabel: direction === 'high' ? '候选高' : '候选低',
        markerColor: direction === 'high' ? '#B71C3B' : '#087F5B',
      }, bar[0] * 1000 + 1000);
      if (!rendered) throw new Error('Actual compound module did not render');
      placements.push({ id, direction, candleEdge, edgeY, x: model.timeScale().indexToCoordinate(index) });
    }
    const ids = chart.getAllShapes().map((shape) => shape.id).filter((id) => !baseline.has(id));
    if (ids.length !== 8 || layer.size !== 4) throw new Error('Independent compound entity count mismatch');
    window.probeCleanup = () => {
      layer.clear();
      const remaining = chart.getAllShapes().map((shape) => shape.id);
      if (remaining.length !== baseline.size || remaining.some((id) => !baseline.has(id))) throw new Error('Compound cleanup changed baseline drawings');
      chart.removeEntity(sentinel);
      return { compoundEntitiesRemoved: ids.length, baselinePreserved: true };
    };
    return {
      resolution: chart.resolution(),
      placements,
      properties: ids.map((id) => {
        const shape = chart.getShapeById(id);
        const properties = shape.getProperties();
        const points = shape.getPoints();
        return { points, properties, y: scale.priceToCoordinate(points[0].price, firstValue) };
      }),
    };
  }, compoundUrl);
  await page.waitForLoadState('networkidle', { timeout: 10000 });
  const fonts = await Promise.all(page.frames().map((frame) => frame.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.race([
      document.fonts.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Demo drawing font deadline exceeded')), 5000)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return [...document.fonts].map((font) => ({ family: font.family, status: font.status }));
  })));
  await page.screenshot({ path: join(output, 'native-shapes.png') });
  const cleanup = await page.evaluate(() => window.probeCleanup());
  console.log(JSON.stringify({ output, ...facts, fonts, cleanup }));
} finally {
  await browser.close();
}
