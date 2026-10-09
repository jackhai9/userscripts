import { test, expect, reloadPageWithCoverage } from '../test.js';
import {
  DATA_PANEL_NOW as NOW, DATA_PANELS as PANELS, POSITION_AUDIT_KEY as AUDIT_KEY,
  CMC_HEADERS, createDataPanelsFixture as createFixture, installDataPanels as installPanels,
} from '../helpers/data-panels-host.js';

const LARGE = { width: 1600, height: 1200 };
const SMALL = { width: 640, height: 420 };
const INITIAL = {
  trading: { left: 1080, top: 700 },
  cmc: { left: 530, top: 620 },
};

async function readPositions(page) {
  return page.evaluate(panels => Object.fromEntries(panels.map(panel => [
    panel.name, JSON.parse(localStorage.getItem(panel.key)),
  ])), PANELS);
}

async function readWrites(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), AUDIT_KEY);
}

async function assertPositions(page, positions) {
  for (const panel of PANELS) {
    expect(await page.locator(`#${panel.id}`).boundingBox()).toMatchObject({
      x: positions[panel.name].left, y: positions[panel.name].top, width: panel.width,
    });
  }
}

/** Wait for the native resize delivery and its rendering frames, including queued saves. */
async function resize(page, viewport) {
  const previous = await page.evaluate(() => window.dataPanelFixture.resizeEvents);
  await page.setViewportSize(viewport);
  await expect.poll(() => page.evaluate(() => window.dataPanelFixture.resizeEvents)).toBeGreaterThan(previous);
  await nextFrames(page);
}

async function nextFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function startDrag(page, panel, target, button = 'left') {
  const header = await page.locator(`#${panel.id}-header`).boundingBox();
  const original = await page.locator(`#${panel.id}`).boundingBox();
  const pointer = { x: header.x + 14, y: header.y + 14 };
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.down({ button });
  await page.mouse.move(pointer.x + target.left - original.x, pointer.y + target.top - original.y, { steps: 3 });
  await nextFrames(page);
}

async function closeWithUnload(page) {
  const closed = page.waitForEvent('close');
  await page.close({ runBeforeUnload: true });
  await closed;
}

/** Model a missed outside mouseup with a trusted browser move reporting no buttons. */
async function returnWithoutPressedButton(page, context, target) {
  const session = await context.newCDPSession(page);
  try {
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: target.left + 50, y: target.top + 50, buttons: 0, button: 'none',
    });
  } finally {
    await session.detach();
  }
  expect(await page.evaluate(() => window.dataPanelFixture.pointerEvents.at(-1))).toEqual({
    buttons: 0, x: target.left + 50, y: target.top + 50, trusted: true,
  });
}

test('user receives the exact isolated fetch and GM data contracts with shared browser storage', async ({ page, context }) => {
  // Given the isolated origin has real fetch, localStorage, and the current GM JSON boundary.
  const fixture = await createFixture(context);
  await fixture.open(page, { install: false });
  const other = await context.newPage();
  await fixture.open(other, { install: false });

  // When one page consumes both public data boundaries and saves a position.
  const result = await page.evaluate(async ({ now, headers, key }) => {
    const response = await fetch('/fapi/v1/time');
    const gm = await new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', timeout: 20_000, headers,
        url: `https://api.coinmarketcap.com/data-api/v1/cryptocurrency/map?symbol=BTC&listing_status=active&_=${now}`,
        onload: resolve, onerror: reject, ontimeout: reject,
      });
    });
    localStorage.setItem(key, JSON.stringify({ left: 71, top: 93 }));
    return { fetch: { status: response.status, body: await response.json() }, gm };
  }, { now: NOW, headers: CMC_HEADERS, key: PANELS[0].key });

  // Then callbacks retain HTTP/text semantics and another tab reads the actual saved coordinates.
  expect(result).toEqual({
    fetch: { status: 200, body: { serverTime: NOW } },
    gm: { status: 200, responseText: JSON.stringify(fixture.map) },
  });
  expect(fixture.requests).toEqual([{ method: 'GET', path: '/fapi/v1/time', params: {} }]);
  expect(fixture.gmRequests).toHaveLength(1);
  expect(await page.evaluate(() => window.dataPanelFixture.gmCompletions)).toEqual([
    { url: fixture.gmRequests[0].url, response: result.gm },
  ]);
  expect(await readPositions(other)).toEqual({ trading: { left: 71, top: 93 }, cmc: null });
  expect(await readWrites(other)).toEqual([{ key: PANELS[0].key, value: { left: 71, top: 93 } }]);
  expect(fixture.errors).toEqual([]);
});

test('user restores both separate panel preferences after a smaller viewport', async ({ page, context }, testInfo) => {
  // Given both generated panels have separate saved positions on the larger screen.
  const fixture = await createFixture(context);
  await fixture.open(page, { positions: INITIAL });
  await assertPositions(page, INITIAL);
  await page.screenshot({ path: testInfo.outputPath('large-before.png') });

  // When the real browser viewport shrinks below both preferred positions.
  await resize(page, SMALL);

  // Then only the displayed positions clamp, leaving each original preference unchanged.
  await assertPositions(page, { trading: { left: 160, top: 372 }, cmc: { left: 140, top: 372 } });
  expect(await readPositions(page)).toEqual(INITIAL);
  expect(await readWrites(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('small-clamped.png') });

  // When the larger viewport returns after the resize event completes.
  await resize(page, LARGE);

  // Then both panels return to their own exact coordinates without another saved position.
  await assertPositions(page, INITIAL);
  expect(await readPositions(page)).toEqual(INITIAL);
  expect(await readWrites(page)).toEqual([]);
  expect(fixture.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('large-restored.png') });
});

test('user keeps large-screen preferences when a small tab opens reloads and closes', async ({ page, context }) => {
  // Given the original tab owns two saved large-screen positions.
  const fixture = await createFixture(context);
  await fixture.open(page, { positions: INITIAL });
  const small = await context.newPage();

  // When another tab mounts the same scripts in a smaller viewport.
  await fixture.open(small, { viewport: SMALL });

  // Then the small tab displays reachable headers while both tabs retain the original preferences.
  await assertPositions(small, { trading: { left: 160, top: 372 }, cmc: { left: 140, top: 372 } });
  expect(await readPositions(page)).toEqual(INITIAL);
  expect(await readWrites(page)).toEqual([]);

  // When the small tab reloads its real document and installs the generated scripts again.
  await reloadPageWithCoverage(small);
  await installPanels(small);

  // Then reload and initialization leave the shared preferences untouched.
  await assertPositions(small, { trading: { left: 160, top: 372 }, cmc: { left: 140, top: 372 } });
  expect(await readPositions(page)).toEqual(INITIAL);
  expect(await readWrites(page)).toEqual([]);

  // When the small tab runs its actual beforeunload handlers and closes.
  await closeWithUnload(small);

  // Then the surviving tab still reads exactly the original positions with zero saves.
  expect(await readPositions(page)).toEqual(INITIAL);
  expect(await readWrites(page)).toEqual([]);
  await assertPositions(page, INITIAL);
  expect(fixture.errors).toEqual([]);
});

test('user keeps a newer drag preference after an older tab closes', async ({ page, context }) => {
  // Given two real tabs share saved preferences but retain their own rendered coordinates.
  const fixture = await createFixture(context);
  await fixture.open(page, { positions: INITIAL });
  const old = await context.newPage();
  await fixture.open(old);
  const changed = { trading: { left: 1100, top: 140 }, cmc: { left: 780, top: 320 } };

  // When the user finishes a real drag for each panel in the current tab.
  for (const panel of PANELS) {
    await startDrag(page, panel, changed[panel.name]);
    await page.mouse.up();
  }
  await nextFrames(page);

  // Then the shared preferences change while the older tab still shows its previous layout.
  expect(await readPositions(page)).toEqual(changed);
  await assertPositions(old, INITIAL);
  const savedBeforeClose = await readWrites(page);

  // When the older tab closes through its actual beforeunload lifecycle.
  await closeWithUnload(old);

  // Then the newer positions remain authoritative and teardown contributes no save.
  expect(await readPositions(page)).toEqual(changed);
  expect(await readWrites(page)).toEqual(savedBeforeClose);
  const reopened = await context.newPage();
  await fixture.open(reopened);
  await assertPositions(reopened, changed);
  expect(fixture.errors).toEqual([]);
});

test('user clicks titles and collapse controls on a small screen without replacing preferred positions', async ({ page, context }) => {
  // Given both preferred positions clamp vertically but their headers remain separately clickable.
  const fixture = await createFixture(context);
  const preferred = { trading: { left: 80, top: 720 }, cmc: { left: 690, top: 660 } };
  await fixture.open(page, { positions: preferred });
  await resize(page, { width: 1200, height: 460 });
  await assertPositions(page, { trading: { left: 80, top: 412 }, cmc: { left: 690, top: 412 } });

  // When the user clicks each title without pointer movement and toggles each collapse control.
  for (const panel of PANELS) {
    await page.locator(`#${panel.id}-header`).click({ position: { x: 14, y: 14 } });
    await page.locator(`#${panel.id}-collapse`).click();
    await expect(page.locator(`#${panel.id}-body`)).toHaveCSS('display', 'none');
    await page.locator(`#${panel.id}-collapse`).click();
  }
  await nextFrames(page);

  // Then title clicks and collapse changes do not save any clamped display coordinate.
  expect(await readPositions(page)).toEqual(preferred);
  expect(await readWrites(page)).toEqual([]);
  await assertPositions(page, { trading: { left: 80, top: 412 }, cmc: { left: 690, top: 412 } });
  expect(fixture.errors).toEqual([]);
});

for (const panel of PANELS) {
  test(`user saves the ${panel.name} panel only once after a drag ends at a changed position`, async ({ page, context }) => {
    // Given both panels have saved positions and the selected header can move freely.
    const fixture = await createFixture(context);
    const initial = { trading: { left: 80, top: 80 }, cmc: { left: 660, top: 100 } };
    const target = panel.name === 'trading' ? { left: 220, top: 220 } : { left: 640, top: 280 };
    await fixture.open(page, { positions: initial });

    // When the user moves the pressed header and the browser executes the queued rendering frames.
    await startDrag(page, panel, target);

    // Then the panel follows the pointer while persistence still contains its previous preference.
    await assertPositions(page, { ...initial, [panel.name]: target });
    expect(await readPositions(page)).toEqual(initial);
    expect(await readWrites(page)).toEqual([]);

    // When the user releases the pointer at the new coordinates.
    await page.mouse.up();
    await nextFrames(page);

    // Then precisely one actual storage write commits the final position and preserves the other panel.
    const changed = { ...initial, [panel.name]: target };
    const expectedWrites = [{ key: panel.key, value: target }];
    expect(await readPositions(page)).toEqual(changed);
    expect(await readWrites(page)).toEqual(expectedWrites);

    // When another gesture moves away and returns to its exact starting coordinates before release.
    await startDrag(page, panel, { left: target.left + 30, top: target.top + 20 });
    const header = await page.locator(`#${panel.id}-header`).boundingBox();
    await page.mouse.move(header.x + 14 - 30, header.y + 14 - 20);
    await page.mouse.up();
    await nextFrames(page);

    // Then a gesture with no final displacement contributes no saved preference.
    await assertPositions(page, changed);
    expect(await readWrites(page)).toEqual(expectedWrites);

    // When the user reloads and the generated scripts mount in a fresh document.
    await reloadPageWithCoverage(page);
    await installPanels(page);

    // Then the committed coordinates return without any mount or unload write.
    await assertPositions(page, changed);
    expect(await readPositions(page)).toEqual(changed);
    expect(await readWrites(page)).toEqual(expectedWrites);
    expect(fixture.errors).toEqual([]);
  });

  test(`user ignores right-button movement over the ${panel.name} header`, async ({ page, context }) => {
    // Given both generated panels have separate saved positions and a real mouse.
    const fixture = await createFixture(context);
    const initial = { trading: { left: 80, top: 80 }, cmc: { left: 660, top: 100 } };
    await fixture.open(page, { positions: initial });

    // When the user presses the right button and moves across the selected header.
    await startDrag(page, panel, { left: initial[panel.name].left + 70, top: 240 }, 'right');
    await page.mouse.up({ button: 'right' });
    await nextFrames(page);

    // Then the gesture neither moves the panel nor saves any preference.
    await assertPositions(page, initial);
    expect(await readPositions(page)).toEqual(initial);
    expect(await readWrites(page)).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  test(`user releases the ${panel.name} header after a viewport change without saving a drag`, async ({ page, context }) => {
    // Given the mouse is pressed on a saved large-screen panel without any drag movement.
    const fixture = await createFixture(context);
    await fixture.open(page, { positions: INITIAL });
    const header = await page.locator(`#${panel.id}-header`).boundingBox();
    await page.mouse.move(header.x + 14, header.y + 14);
    await page.mouse.down();

    // When the viewport shrinks and the user releases the stationary pointer.
    await resize(page, SMALL);
    await page.mouse.up();
    await nextFrames(page);

    // Then the viewport adjustment is temporary and cannot become a completed drag preference.
    await assertPositions(page, { trading: { left: 160, top: 372 }, cmc: { left: 140, top: 372 } });
    expect(await readPositions(page)).toEqual(INITIAL);
    expect(await readWrites(page)).toEqual([]);

    // When the original viewport returns and the mouse moves without another press.
    await resize(page, LARGE);
    await page.mouse.move(600, 180);
    await nextFrames(page);

    // Then the panels restore their own preferences and the cancelled gesture stays inactive.
    await assertPositions(page, INITIAL);
    expect(await readWrites(page)).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  for (const cancellation of ['window blur', 'a return without the primary button']) {
    test(`user abandons the ${panel.name} drag after ${cancellation}`, async ({ page, context }) => {
      // Given both panels have saved preferences and the selected panel is mid-drag.
      const fixture = await createFixture(context);
      const initial = { trading: { left: 80, top: 80 }, cmc: { left: 660, top: 100 } };
      const target = { left: initial[panel.name].left + 80, top: 220 };
      await fixture.open(page, { positions: initial });
      await startDrag(page, panel, target);
      await assertPositions(page, { ...initial, [panel.name]: target });

      // When the browser reports cancellation before the pointer continues moving and is released.
      if (cancellation === 'window blur') {
        // Headless tabs retain focus; deliver the real window handler's explicit focus boundary.
        await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
      } else {
        await returnWithoutPressedButton(page, context, target);
      }
      await nextFrames(page);
      await page.mouse.move(1030, 200);
      await page.mouse.up();
      await nextFrames(page);

      // Then cancellation restores the saved coordinates and later movement cannot resume the drag.
      await assertPositions(page, initial);
      expect(await readPositions(page)).toEqual(initial);
      expect(await readWrites(page)).toEqual([]);
      expect(fixture.errors).toEqual([]);
    });
  }
}

test('user keeps responsive default panel positions without creating a saved preference', async ({ page, context }) => {
  // Given neither panel has a saved position and both generated scripts mount on a large screen.
  const fixture = await createFixture(context);
  await fixture.open(page);

  // When the viewport changes to a smaller screen and back through real resize events.
  await resize(page, SMALL);
  const trading = await page.locator(`#${PANELS[0].id}`).boundingBox();
  const cmc = await page.locator(`#${PANELS[1].id}`).boundingBox();
  expect(trading).toMatchObject({ x: 144, y: 8, width: 480 });
  expect(cmc).toMatchObject({ x: 124, width: 500 });
  expect(cmc.y - trading.y - trading.height).toBeCloseTo(8, 1);
  expect(cmc.y + cmc.height).toBeLessThanOrEqual(SMALL.height);
  await resize(page, LARGE);

  // Then the original right inset and separate desktop columns return without new position keys.
  await assertPositions(page, { trading: { left: 1104, top: 60 }, cmc: { left: 588, top: 60 } });
  expect(await readPositions(page)).toEqual({ trading: null, cmc: null });
  expect(await readWrites(page)).toEqual([]);

  // When another default-position tab mounts on the small screen and closes normally.
  const other = await context.newPage();
  await fixture.open(other, { viewport: SMALL });
  await closeWithUnload(other);

  // Then neither mounting nor beforeunload creates a persistent position preference.
  expect(await readPositions(page)).toEqual({ trading: null, cmc: null });
  expect(await readWrites(page)).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
