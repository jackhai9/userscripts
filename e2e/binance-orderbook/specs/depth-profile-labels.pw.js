import { test, expect } from '../test.js';
import { readFixtureState } from '../helpers/userscript-page.js';
import {
  DEPTH_LABEL_SYMBOL,
  DEPTH_PROFILE_SELECTOR,
  emitDepthLabelUpdate,
  openDepthLabelScenario,
  readDepthChartLayout,
  readDepthDrawing,
} from '../helpers/depth-profile-fixture.js';

const labelTexts = async (page) => (await readDepthDrawing(page)).texts.map(({ text }) => text).sort();
const backgrounds = (drawing) => drawing.rectangles.filter(({ height }) => height === 16);
const intersects = (left, right) => (
  left.x < right.x + right.width && left.x + left.width > right.x
  && left.y < right.y + right.height && left.y + left.height > right.y
);

async function expectCompactLabelGeometry(page, { currentPriceY = null } = {}) {
  const drawing = await readDepthDrawing(page);
  const boxes = backgrounds(drawing);
  const canvas = await page.locator(`${DEPTH_PROFILE_SELECTOR} canvas`).boundingBox();
  const toggle = await page.locator(`${DEPTH_PROFILE_SELECTOR} button`).boundingBox();
  const toggleInCanvas = { ...toggle, x: toggle.x - canvas.x, y: toggle.y - canvas.y };
  expect(canvas.width).toBe(132);
  expect(canvas.height).toBe(260);
  expect(boxes).toHaveLength(drawing.texts.length);
  expect(boxes.length).toBeGreaterThan(0);
  expect(boxes.length).toBeLessThanOrEqual(4);
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    const text = drawing.texts[index];
    expect(box.width).toBeLessThanOrEqual(88);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.height);
    expect(text.font).toMatch(/^11px /);
    expect(text.width + 6).toBeLessThanOrEqual(box.width + 0.01);
    expect(text.x).toBeCloseTo(box.x + 3, 6);
    expect(intersects(box, toggleInCanvas)).toBe(false);
    if (currentPriceY !== null) {
      expect(box.y + box.height <= currentPriceY || box.y >= currentPriceY + 1).toBe(true);
    }
    for (const other of boxes.slice(index + 1)) expect(intersects(box, other)).toBe(false);
  }
  const alpha = await page.locator(`${DEPTH_PROFILE_SELECTOR} canvas`).evaluate((element, boxes) => (
    boxes.map((box) => element.getContext('2d').getImageData(
      Math.floor((box.x + box.width - 2) * devicePixelRatio),
      Math.floor((box.y + box.height - 2) * devicePixelRatio), 1, 1,
    ).data[3])
  ), boxes);
  expect(alpha).toEqual(boxes.map(() => 255));
  return { drawing, boxes, canvas };
}

async function expectIsolatedReadOnlyFixture(page, evidence) {
  expect(evidence.errors).toEqual([]);
  expect(evidence.snapshotRequests).toEqual([{ symbol: DEPTH_LABEL_SYMBOL, limit: '1000' }]);
  expect(await page.evaluate(() => window.__DEPTH_LABEL_FIXTURE__.socketCount)).toBe(1);
  const state = await readFixtureState(page);
  expect(state.orders).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'order-submitted' || type === 'cancel-requested'))
    .toEqual([]);
}

async function attachChart(page, testInfo, name) {
  const path = testInfo.outputPath(name);
  await page.locator('.chart-widget-root').screenshot({ path });
  await testInfo.attach(name, {
    path,
    contentType: 'image/png',
  });
}

test('compact depth quantities preserve cumulative bars, chart layout and click-through', async ({ page }, testInfo) => {
  const evidence = await openDepthLabelScenario(page);
  await expect.poll(() => labelTexts(page)).toEqual(['1.3 · 620K', '1.8 · 3.8M', '2 · 2.4M']);
  const { drawing, boxes, canvas } = await expectCompactLabelGeometry(page, { currentPriceY: 182 });
  const largeAskBar = drawing.rectangles.find((rectangle) => (
    rectangle.height === 1 && rectangle.fillStyle === '#f6465d' && rectangle.y === 104
  ));
  expect(largeAskBar.width).toBeCloseTo(3_825_000 / 6_225_000 * 132, 6);
  expect(largeAskBar.x + largeAskBar.width).toBeCloseTo(132, 6);
  expect(await readDepthChartLayout(page)).toEqual(evidence.initialLayout);
  expect(evidence.initialLayout.frame).toMatchObject({ width: 698, height: 260 });
  expect(evidence.initialLayout.axis).toMatchObject({ width: 60, height: 260 });
  expect(await page.locator(DEPTH_PROFILE_SELECTOR).evaluate((root) => ({
    pointerEvents: getComputedStyle(root).pointerEvents,
    canvasPointerEvents: getComputedStyle(root.querySelector('canvas')).pointerEvents,
    childTags: [...root.children].map(({ tagName }) => tagName),
  }))).toEqual({ pointerEvents: 'none', canvasPointerEvents: 'none', childTags: ['CANVAS', 'BUTTON', 'DIV'] });

  const label = boxes[0];
  await page.mouse.click(canvas.x + label.x + label.width / 2, canvas.y + label.y + label.height / 2);
  expect(await page.evaluate(() => window.__DEPTH_LABEL_FIXTURE__.chartClicks)).toBe(1);
  await expectIsolatedReadOnlyFixture(page, evidence);
  await attachChart(page, testInfo, 'compact-depth-labels.png');
});

test('pixel-row quantities remain readable with no latest price and a wide price band', async ({ page }, testInfo) => {
  const evidence = await openDepthLabelScenario(page, {
    currentPrice: null,
    levels: {
      asks: [['1.8', '1500000'], ['1.8008', '2300000'], ['2', '2400000'], ['2.1', '2000000']],
      bids: [['1.49', '600000'], ['1.4', '700000'], ['1.3', '900000']],
    },
  });
  await expect.poll(() => labelTexts(page)).toEqual(['1.3 · 900K', '1.4 · 700K', '2 · 2.4M', '3.8M']);
  const { drawing } = await expectCompactLabelGeometry(page);
  await expect(page.locator('.tradew-tradelist .price.emit-price').first()).toHaveText('—');
  const aggregatedBar = drawing.rectangles.find((rectangle) => (
    rectangle.height === 1 && rectangle.fillStyle === '#f6465d' && rectangle.y === 104
  ));
  expect(aggregatedBar.width).toBeCloseTo(3_800_000 / 8_200_000 * 132, 6);
  expect(drawing.rectangles.filter((rectangle) => (
    rectangle.height === 1 && rectangle.fillStyle === '#f6465d' && rectangle.y === 104
  ))).toHaveLength(1);
  expect(await readDepthChartLayout(page)).toEqual(evidence.initialLayout);
  await expectIsolatedReadOnlyFixture(page, evidence);
  await attachChart(page, testInfo, 'aggregated-depth-labels.png');
});

test('native updates, collapse and disconnect remove stale depth label pixels', async ({ page }, testInfo) => {
  const evidence = await openDepthLabelScenario(page);
  await expect.poll(() => labelTexts(page)).toContain('1.8 · 3.8M');
  await emitDepthLabelUpdate(page, {
    asks: [['1.8', '1200'], ['2', '0'], ['2.05', '2600000']],
    bids: [['1.3', '0'], ['1.35', '900000']],
  });
  const updatedTexts = ['1.35 · 900K', '2.05 · 2.6M'];
  await expect.poll(() => labelTexts(page)).toEqual(updatedTexts);
  await expectCompactLabelGeometry(page, { currentPriceY: 182 });
  await attachChart(page, testInfo, 'updated-depth-labels.png');

  const root = page.locator(DEPTH_PROFILE_SELECTOR);
  await root.locator('button').click();
  await expect(root).toHaveAttribute('data-expanded', 'false');
  await expect(root.locator('canvas')).toBeHidden();
  await expect.poll(() => labelTexts(page)).toEqual([]);
  expect(await readDepthChartLayout(page)).toEqual(evidence.initialLayout);
  await root.locator('button').click();
  await expect(root).toHaveAttribute('data-expanded', 'true');
  await expect.poll(() => labelTexts(page)).toEqual(updatedTexts);
  expect(await readDepthChartLayout(page)).toEqual(evidence.initialLayout);

  await page.evaluate(() => window.__DEPTH_LABEL_FIXTURE__.socket.dispatchEvent(new Event('close')));
  await expect(root.locator('.jh-depth-profile-status')).toHaveText('重新连接深度');
  await expect.poll(() => labelTexts(page)).toEqual([]);
  expect(await root.locator('canvas').evaluate((canvas) => (
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.every((value) => value === 0)
  ))).toBe(true);
  await expectIsolatedReadOnlyFixture(page, evidence);
  await attachChart(page, testInfo, 'cleared-depth-labels.png');
});
