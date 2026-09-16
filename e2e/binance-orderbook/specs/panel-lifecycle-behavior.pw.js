import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const INPUT = '#jh-binance-close-qty-multiplier-input';
const LONG = '#jh-binance-close-side-long';
const SHORT = '#jh-binance-close-side-short';
const FINAL_QUANTITY = '#jh-binance-close-qty-final';
const MULTIPLIER_PREFIX = 'jh_binance_qty_multiplier_v2';

async function multiplierValue(page, mode, symbol = CURRENT_SYMBOL, precision = '0.1') {
  return page.evaluate(key => localStorage.getItem(key), `${MULTIPLIER_PREFIX}:${mode}:${symbol}:${precision}`);
}

async function expectNoOrderActions(page) {
  expect((await readFixtureState(page)).events.filter(({ type }) => (
    type === 'order-submitted' || type === 'cancel-requested'
  ))).toEqual([]);
}

test('user sanitizes multiplier typing and repairs an invalid value on blur', async ({ page }) => {
  // Given the complete generated entrypoint displays the current minimum open quantity.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  const input = page.locator(INPUT);
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.07');

  // When the user types mixed characters into the numeric multiplier.
  await input.fill('2a.3');

  // Then the input and saved setting contain only digits and the real quantity calculation updates.
  await expect(input).toHaveValue('23');
  await expect(page.locator('[data-multiplier-formula-prefix]')).toHaveText('0.07 × 23 =');
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('1.61');
  expect(await multiplierValue(page, 'OPEN')).toBe('23');

  // When the user replaces it with an invalid zero while still editing.
  await input.fill('0');

  // Then invalid input is visible but cannot replace the last valid saved multiplier.
  await expect(input).toHaveValue('0');
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('请输入正整数倍数');
  await expect(page.locator('#jh-binance-close-qty-multiplier-dec')).toBeDisabled();
  expect(await multiplierValue(page, 'OPEN')).toBe('23');

  // When the user leaves the invalid field.
  await input.blur();

  // Then the documented multiplier of one is committed with the original minimum quantity.
  await expect(input).toHaveValue('1');
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.07');
  expect(await multiplierValue(page, 'OPEN')).toBe('1');
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user can clear a multiplier temporarily and commit its minimum on blur', async ({ page }) => {
  // Given a valid edited multiplier has already been saved.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  const input = page.locator(INPUT);
  await input.fill('4');

  // When the user clears the active field.
  await input.fill('');

  // Then the empty edit remains visible without overwriting the valid saved value.
  await expect(input).toHaveValue('');
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('请输入正整数倍数');
  expect(await multiplierValue(page, 'OPEN')).toBe('4');

  // When the empty edit loses focus.
  await input.blur();

  // Then the input, saved value, and formula return to a multiplier of one.
  await expect(input).toHaveValue('1');
  expect(await multiplierValue(page, 'OPEN')).toBe('1');
  await expect(page.locator('[data-multiplier-formula-prefix]')).toHaveText('0.07 × 1 =');
  expect(errors).toEqual([]);
});

test('user decrements a multiplier only to one and repeated presses retain a single field identity', async ({ page }) => {
  // Given the default multiplier disables decrement and exposes one editable field.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  const input = page.locator(INPUT);
  const handle = await input.elementHandle();
  const decrement = page.locator('#jh-binance-close-qty-multiplier-dec');
  await expect(decrement).toBeDisabled();

  // When two consecutive increment clicks are followed by two decrement clicks.
  await page.locator('#jh-binance-close-qty-multiplier-inc').dblclick();
  await expect(input).toHaveValue('3');
  await decrement.click();
  await expect(input).toHaveValue('2');
  await decrement.click();

  // Then the multiplier reaches one without replacing the field or submitting an order.
  await expect(input).toHaveValue('1');
  await expect(decrement).toBeDisabled();
  expect(await handle.evaluate(element => element === document.querySelector('#jh-binance-close-qty-multiplier-input'))).toBe(true);
  expect(await multiplierValue(page, 'OPEN')).toBe('1');
  await handle.dispose();
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user keeps independent open and close multipliers while switching the native form', async ({ page }) => {
  // Given both position directions are available and the open multiplier is five.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '4' }, { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '7' }],
  }));
  await page.locator(INPUT).fill('5');
  await page.locator(INPUT).blur();

  // When the user enters close mode and edits its independent multiplier.
  await page.locator('#position-direction [data-trade-mode="CLOSE"]').click();
  await expect(page.locator(INPUT)).toHaveValue('1');
  await expect(page.locator('#jh-binance-qty-multiplier-hint')).toHaveText('最小平仓量的');
  await page.locator(INPUT).fill('3');
  await page.locator(INPUT).blur();

  // Then the close formula uses the close minimum while the open setting stays five.
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.03');
  await expect(page.locator('#jh-binance-close-qty-min')).toBeHidden();
  expect(await multiplierValue(page, 'OPEN')).toBe('5');
  expect(await multiplierValue(page, 'CLOSE')).toBe('3');

  // When the user returns to the native open mode.
  await page.locator('#position-direction [data-trade-mode="OPEN"]').click();

  // Then the original open setting and notional constraint return unchanged.
  await expect(page.locator(INPUT)).toHaveValue('5');
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.35');
  await expect(page.locator('#jh-binance-close-qty-min')).toHaveText('≥5U @ 81');
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user keeps multiplier preferences independent for each native price precision', async ({ page }) => {
  // Given the current 0.1 precision has a saved multiplier of seven.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  await page.locator(INPUT).fill('7');
  await page.locator(INPUT).blur();
  const finer = page.locator('[data-orderbook-precision-value="0.01"]');
  await expect(finer).toBeEnabled();

  // When the user selects 0.01 precision and saves a different multiplier.
  await finer.click();
  await expect(page.locator('#futuresOrderbook .tick-content')).toHaveText('0.01');
  await expect(page.locator(INPUT)).toHaveValue('1');
  await page.locator(INPUT).fill('4');
  await page.locator(INPUT).blur();

  // Then each precision keeps exactly its own stored multiplier.
  expect(await multiplierValue(page, 'OPEN', CURRENT_SYMBOL, '0.1')).toBe('7');
  expect(await multiplierValue(page, 'OPEN', CURRENT_SYMBOL, '0.01')).toBe('4');

  // When the user returns to the original price precision.
  await page.locator('[data-orderbook-precision-value="0.1"]').click();

  // Then the panel restores seven from the matching precision scope.
  await expect(page.locator(INPUT)).toHaveValue('7');
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

for (const eventType of ['input', 'blur']) {
  test(`user discards a stale multiplier ${eventType} after a symbol transition`, async ({ page }) => {
    // Given the focused HYPE field has saved five in its current symbol scope.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());
    await page.locator(INPUT).fill('5');

    // When native navigation changes symbol before an old field event is delivered.
    await page.evaluate(({ symbol, inputId, eventType }) => {
      const input = document.getElementById(inputId);
      window.__BINANCE_FIXTURE__.switchSymbol(symbol);
      input.value = '99';
      if (eventType === 'blur') input.blur();
      else input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '99' }));
    }, { symbol: OTHER_SYMBOL, inputId: INPUT.slice(1), eventType });

    // Then the stale value cannot cross into the new symbol's multiplier settings.
    await expect(page.locator(INPUT)).toHaveValue('1');
    expect(await multiplierValue(page, 'OPEN', CURRENT_SYMBOL)).toBe('5');
    expect(await multiplierValue(page, 'OPEN', OTHER_SYMBOL)).toBe(null);

    // When the native page returns to the original symbol.
    await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), CURRENT_SYMBOL);

    // Then the original scope still displays five and no order action occurred.
    await expect(page.locator(INPUT)).toHaveValue('5');
    await expectNoOrderActions(page);
    expect(errors).toEqual([]);
  });
}

test('user changes open direction with arrow keys while preserving radio focus and symbol ownership', async ({ page }) => {
  // Given both open directions are enabled and Long owns the radio tab stop.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  const long = page.locator(LONG);
  const short = page.locator(SHORT);
  await long.focus();
  await expect(long).toHaveAttribute('aria-checked', 'true');

  // When ArrowLeft wraps from Long to Short.
  await long.press('ArrowLeft');

  // Then Short becomes checked, focused, and persisted for the current symbol.
  await expect(short).toBeFocused();
  await expect(short).toHaveAttribute('aria-checked', 'true');
  await expect(short).toHaveAttribute('tabindex', '0');
  await expect(long).toHaveAttribute('tabindex', '-1');
  expect(await page.evaluate(() => localStorage.getItem('jh_binance_open_side:HYPEUSDT'))).toBe('SHORT');

  // When the other supported arrow keys cycle both directions and an unrelated key is pressed.
  await short.press('ArrowDown');
  await expect(long).toBeFocused();
  await long.press('ArrowRight');
  await expect(short).toBeFocused();
  await short.press('ArrowUp');
  await long.press('Home');

  // Then Long remains the selected tab stop and no trade or cancel action was issued.
  await expect(long).toBeFocused();
  await expect(long).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('jh_binance_open_side:HYPEUSDT'))).toBe('LONG');
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

const CLOSE_DISPLAYS = [
  { label: 'long position only', longQty: '4', shortQty: '0', longDisabled: false, shortDisabled: true, selected: 'LONG', zhHint: '当前仅有多仓', enHint: 'long position only' },
  { label: 'short position only', longQty: '0', shortQty: '7', longDisabled: true, shortDisabled: false, selected: 'SHORT', zhHint: '当前仅有空仓', enHint: 'short position only' },
  { label: 'hedged positions', longQty: '4', shortQty: '7', longDisabled: false, shortDisabled: false, selected: 'LONG', zhHint: '双向持仓', enHint: 'hedged positions' },
  { label: 'no position', longQty: '0', shortQty: '0', longDisabled: true, shortDisabled: true, selected: 'LONG', zhHint: '暂无可平仓位', enHint: 'no position to close' },
];

for (const locale of ['zh-CN', 'en']) {
  for (const display of CLOSE_DISPLAYS) {
    test(`user sees ${display.label} with the correct ${locale} close controls`, async ({ page }) => {
      // Given the native close form owns the declared current-symbol position quantities.
      const { errors } = await openUserscriptScenario(page, createCancelScenario({
        ui: { tradeMode: 'CLOSE' },
        positions: [
          { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: display.longQty },
          { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: display.shortQty },
        ],
      }));

      // When the route applies the requested panel language and refreshes the real entrypoint.
      await page.evaluate(({ locale, symbol }) => {
        history.pushState({}, '', `/${locale}/futures/${symbol}`);
        window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
      }, { locale, symbol: CURRENT_SYMBOL });

      // Then the position evidence controls both script and native buttons with the same semantics.
      await expect(page.locator(LONG)).toHaveText(locale === 'en' ? 'Long' : '平多');
      await expect(page.locator(SHORT)).toHaveText(locale === 'en' ? 'Short' : '平空');
      expect(await page.locator(`${PANEL} [data-side-selector] [role="radio"]`).evaluateAll(buttons => buttons.map(button => button.id)))
        .toEqual([LONG.slice(1), SHORT.slice(1)]);
      await expect(page.locator(LONG)).toHaveCSS('order', '0');
      await expect(page.locator(SHORT)).toHaveCSS('order', '1');
      await expect(page.locator(LONG)).toBeEnabled({ enabled: !display.longDisabled });
      await expect(page.locator(SHORT)).toBeEnabled({ enabled: !display.shortDisabled });
      await expect(page.locator('.order-entry').getByRole('button', { name: '平多', exact: true }))
        .toBeEnabled({ enabled: !display.longDisabled });
      await expect(page.locator('.order-entry').getByRole('button', { name: '平空', exact: true }))
        .toBeEnabled({ enabled: !display.shortDisabled });
      await expect(page.locator(display.selected === 'LONG' ? LONG : SHORT)).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('#jh-binance-trade-mode-hint')).toHaveAttribute('title', new RegExp(locale === 'en' ? display.enHint : display.zhHint));
      await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.01');
      await expect(page.locator('#jh-binance-qty-multiplier-hint')).toHaveText(locale === 'en' ? 'Minimum close qty' : '最小平仓量的');
      await expectNoOrderActions(page);
      expect(errors).toEqual([]);
    });
  }
}

for (const missing of ['precision', 'mode']) {
  test(`user cannot edit numeric panel controls while native ${missing} is unknown`, async ({ page }) => {
    // Given the complete panel has saved a multiplier of six for a valid native context.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());
    await page.locator(INPUT).fill('6');
    await page.locator(INPUT).blur();

    // When the native DOM temporarily loses one required context value.
    await page.evaluate(missing => {
      if (missing === 'precision') document.querySelector('#futuresOrderbook .tick-content').textContent = '';
      else document.querySelectorAll('#position-direction [role="tab"]').forEach(tab => tab.setAttribute('aria-selected', 'false'));
      window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
    }, missing);

    // Then numeric edits are disabled and the specific missing context is explained without losing preferences.
    await expect(page.locator(INPUT)).toBeDisabled();
    await expect(page.locator('#jh-binance-close-qty-multiplier-inc')).toBeDisabled();
    await expect(page.locator('#jh-binance-close-qty-multiplier-dec')).toBeDisabled();
    await expect(page.locator(FINAL_QUANTITY)).toHaveText(missing === 'precision' ? '等待价格精度' : '等待开仓/平仓状态');
    expect(await multiplierValue(page, 'OPEN')).toBe('6');

    // When the same native context becomes available again.
    await page.evaluate(missing => {
      if (missing === 'precision') document.querySelector('#futuresOrderbook .tick-content').textContent = '0.1';
      else document.querySelector('#position-direction [data-trade-mode="OPEN"]').setAttribute('aria-selected', 'true');
      window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
    }, missing);

    // Then the existing multiplier returns in the enabled field.
    await expect(page.locator(INPUT)).toBeEnabled();
    await expect(page.locator(INPUT)).toHaveValue('6');
    await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.42');
    await expectNoOrderActions(page);
    expect(errors).toEqual([]);
  });
}

test('user reacquires a replaced native form root while retaining the same panel and multiplier', async ({ page }) => {
  // Given the panel has a saved value and observers are attached to the original form root.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  await page.locator(INPUT).fill('8');
  await page.locator(INPUT).blur();
  const originalForm = await page.locator('#trade-form').elementHandle();
  const originalPanel = await page.locator(PANEL).elementHandle();

  // When React replaces the native form and its normal renderer rebinds the current mode.
  await page.evaluate(symbol => {
    const form = document.querySelector('#trade-form');
    form.replaceWith(form.cloneNode(true));
    window.__BINANCE_FIXTURE__.switchSymbol(symbol);
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
  }, CURRENT_SYMBOL);

  // Then the real input resolver follows the new form and the existing panel keeps its saved value.
  expect(await originalForm.evaluate(element => element.isConnected)).toBe(false);
  expect(await originalPanel.evaluate(element => element === document.querySelector('#jh-binance-close-qty-multiplier-panel'))).toBe(true);
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(INPUT)).toHaveValue('8');
  expect(await page.evaluate(() => window.__TM_CLOSE_LONG_DEBUG__.findQtyInput().id)).toBe('unitAmount-open');
  await expect(page.locator('#jh-binance-close-qty-multiplier-spacer')).toHaveCount(1);
  await originalForm.dispose();
  await originalPanel.dispose();
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user removes the panel outside futures routes and restores saved settings with the new locale', async ({ page }) => {
  // Given route lifecycle timing is controlled and the native panel has saved multiplier nine.
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  await page.locator(INPUT).fill('9');
  await page.locator(INPUT).blur();
  await pauseScenarioClock(page);

  // When navigation leaves futures and the watchdog advances through two route checks.
  await page.evaluate(() => history.pushState({}, '', '/zh-CN/markets'));
  await page.clock.runFor(10_000);

  // Then trading UI remains removed while its scoped setting is retained.
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator('#jh-binance-close-qty-multiplier-spacer')).toHaveCount(0);
  expect(await multiplierValue(page, 'OPEN')).toBe('9');

  // When the native SPA returns to the English futures route and foreground lifecycle resumes.
  await page.evaluate(symbol => {
    history.pushState({}, '', `/en/futures/${symbol}`);
    document.dispatchEvent(new Event('visibilitychange'));
  }, CURRENT_SYMBOL);
  await page.clock.runFor(100);

  // Then a single English panel restores the current symbol's saved multiplier.
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(INPUT)).toHaveValue('9');
  await expect(page.locator('#jh-binance-qty-multiplier-hint')).toHaveText('Minimum open qty');
  await expect(page.locator(LONG)).toHaveText('Long');
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user keeps an unchanged panel free of DOM writes during repeated stable renders', async ({ page }) => {
  // Given the generated panel and native precision options have finished their initial renders.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  await expect(page.locator('[data-orderbook-precision-value="0.01"]')).toBeEnabled();
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.07');

  // When the existing public diagnostic entry requests several renders without changing inputs.
  const mutations = await page.evaluate(() => {
    const panel = document.querySelector('#jh-binance-close-qty-multiplier-panel');
    const observer = new MutationObserver(() => {});
    observer.observe(panel, { attributes: true, childList: true, characterData: true, subtree: true });
    for (let index = 0; index < 3; index += 1) window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
    const records = observer.takeRecords().map(record => ({ type: record.type, attribute: record.attributeName, target: record.target.id }));
    observer.disconnect();
    return records;
  });

  // Then stable rendering does not rewrite panel text, controls, or styles.
  expect(mutations).toEqual([]);
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

/** Build native-looking quantity markup while retaining real layout and buttons. */
async function mountQuantityLabels(page, { mode, combined }) {
  return page.evaluate(({ mode, combined }) => {
    const root = document.querySelector('.order-entry');
    root.querySelectorAll('[data-testid^="max-"]').forEach(element => element.remove());
    root.style.display = 'grid';
    root.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    root.style.position = 'relative';
    root.style.columnGap = '4px';
    const buttons = [...root.querySelectorAll('button')];
    buttons.forEach((button, index) => {
      button.style.gridRow = '2';
      button.style.gridColumn = String(index + 1);
      button.style.width = '100%';
    });
    const label = mode === 'OPEN' ? '可开' : '可平';
    const malformed = document.createElement('small');
    malformed.textContent = `${label} unavailable`;
    malformed.style.position = 'absolute';
    malformed.style.top = '0';
    root.append(malformed);
    const above = document.createElement('small');
    above.textContent = `${label} 888 HYPE`;
    above.style.position = 'absolute';
    above.style.top = '-400px';
    root.append(above);
    const labels = [];
    if (combined) {
      const element = document.createElement('div');
      element.id = 'fixture-combined-quantity';
      element.textContent = `${label} 12 HYPE ${label} 34 HYPE`;
      element.style.gridColumn = '1 / -1';
      element.style.gridRow = '3';
      root.append(element);
      labels.push(element);
    } else {
      for (const [index, quantity] of ['12', '34'].entries()) {
        const element = document.createElement('div');
        element.id = index === 0 ? 'fixture-long-quantity' : 'fixture-short-quantity';
        element.textContent = `${label} ${quantity} HYPE`;
        element.style.gridColumn = String(index + 1);
        element.style.gridRow = '3';
        root.append(element);
        labels.push(element);
      }
    }
    const below = document.createElement('small');
    below.textContent = `${label} 999 HYPE`;
    below.style.position = 'absolute';
    below.style.top = '500px';
    root.append(below);
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
    return {
      buttonCenters: buttons.map(button => {
        const rect = button.getBoundingClientRect();
        return (rect.left + rect.right) / 2;
      }),
      labelCenters: labels.map(element => {
        const rect = element.getBoundingClientRect();
        return (rect.left + rect.right) / 2;
      }),
      aboveDistance: above.getBoundingClientRect().top - buttons[0].getBoundingClientRect().bottom,
      belowDistance: below.getBoundingClientRect().top - buttons[0].getBoundingClientRect().bottom,
    };
  }, { mode, combined });
}

for (const combined of [false, true]) {
  test(`user reads both open quantities from ${combined ? 'one shared label' : 'directional labels'} beside native buttons`, async ({ page }) => {
    // Given native test ids are absent and actual layout places valid labels beside their buttons.
    const { errors } = await openUserscriptScenario(page, createCancelScenario());
    const geometry = await mountQuantityLabels(page, { mode: 'OPEN', combined });
    expect(geometry.buttonCenters[0]).toBeLessThan(geometry.buttonCenters[1]);
    expect(geometry.aboveDistance).toBeLessThan(-32);
    expect(geometry.belowDistance).toBeGreaterThan(240);
    if (combined) {
      expect(geometry.buttonCenters[0]).toBeLessThan(geometry.labelCenters[0]);
      expect(geometry.buttonCenters[1]).toBeGreaterThan(geometry.labelCenters[0]);
    }

    // When the complete production planner reads each directional source without submitting it.
    const quantities = await page.evaluate(async () => {
      const long = await window.__TM_CLOSE_LONG_DEBUG__.buildLadderPlan('OPEN_LONG');
      const short = await window.__TM_CLOSE_LONG_DEBUG__.buildLadderPlan('OPEN_SHORT');
      return { long: long.baseQty, short: short.baseQty };
    });

    // Then valid nearby labels own the quantities while malformed and far-away text is ignored.
    expect(quantities).toEqual({ long: '12', short: '34' });
    await expectNoOrderActions(page);
    expect(errors).toEqual([]);
  });
}

test('user resolves close direction from real nearby quantities and reacts to a confirmed zero side', async ({ page }) => {
  // Given native ids are absent while independently positioned labels confirm both close quantities.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    ui: { tradeMode: 'CLOSE' },
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '12' }, { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '34' }],
  }));
  const geometry = await mountQuantityLabels(page, { mode: 'CLOSE', combined: false });
  expect(geometry.labelCenters).toEqual(geometry.buttonCenters);
  expect(geometry.aboveDistance).toBeLessThan(-16);
  expect(geometry.belowDistance).toBeGreaterThan(200);

  // When the user chooses the short direction and the production resolver reads current native text.
  await page.locator(SHORT).click();
  const action = await page.evaluate(() => {
    const result = window.__TM_CLOSE_LONG_DEBUG__.resolveTradeAction();
    return { mode: result.mode, side: result.side, by: result.by, longQty: result.longQty, shortQty: result.shortQty, qtySource: result.qtySource };
  });

  // Then the chosen side and exact quantities come from the nearby native labels.
  expect(action).toEqual({ mode: 'CLOSE', side: '平空', by: 'dual_panel', longQty: 12, shortQty: 34, qtySource: 'near_button' });

  // When the native long-side label confirms that its position has reached zero.
  await page.locator('#fixture-long-quantity').evaluate(element => { element.textContent = '可平 0 HYPE'; });
  await page.evaluate(() => window.__TM_CLOSE_LONG_DEBUG__.renderPanel());

  // Then only the remaining short position stays actionable in both panel and native controls.
  await expect(page.locator(LONG)).toBeDisabled();
  await expect(page.locator(SHORT)).toBeEnabled();
  await expect(page.locator(SHORT)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.order-entry').getByRole('button', { name: '平多', exact: true })).toBeDisabled();
  await expect(page.locator('#jh-binance-trade-mode-hint')).toHaveAttribute('title', /当前仅有空仓/);
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user keeps cached close display while refusing execution until both native quantities return', async ({ page }) => {
  // Given the current close display has confirmed long and short position quantities.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    ui: { tradeMode: 'CLOSE' },
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '12' }, { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '34' }],
  }));
  await expect(page.locator(LONG)).toBeEnabled();
  await expect(page.locator(SHORT)).toBeEnabled();

  // When a native rerender temporarily removes all quantity evidence.
  const unresolved = await page.evaluate(() => {
    document.querySelectorAll('.order-entry [data-testid^="max-"]').forEach(element => element.remove());
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
    const display = window.__TM_CLOSE_LONG_DEBUG__.displayCloseState;
    return {
      action: window.__TM_CLOSE_LONG_DEBUG__.resolveTradeAction(),
      display: { longQty: display.longQty, shortQty: display.shortQty, isPending: display.isPending, isUsingCache: display.isUsingCache },
    };
  });

  // Then the last confirmed display remains visible but missing current evidence cannot choose an executable action.
  expect(unresolved).toEqual({ action: null, display: { longQty: 12, shortQty: 34, isPending: true, isUsingCache: true } });
  await expect(page.locator('#jh-binance-trade-mode-hint')).toHaveAttribute('title', /暂沿用上次识别结果/);

  // When native quantity fields return with a smaller long position and no short position.
  await page.evaluate(() => {
    document.querySelector('.order-entry').insertAdjacentHTML('beforeend', '<div data-testid="max-sell-amount">可平 3 HYPE</div><div data-testid="max-buy-amount">可平 0 HYPE</div>');
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
  });

  // Then the fresh snapshot replaces cached display and enables only closing the long position.
  await expect(page.locator(LONG)).toBeEnabled();
  await expect(page.locator(SHORT)).toBeDisabled();
  const recovered = await page.evaluate(() => {
    const result = window.__TM_CLOSE_LONG_DEBUG__.resolveTradeAction();
    return { side: result.side, longQty: result.longQty, shortQty: result.shortQty, qtySource: result.qtySource };
  });
  expect(recovered).toEqual({ side: '平多', longQty: 3, shortQty: 0, qtySource: 'testid' });
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user cannot resolve a close action when native buttons and quantity labels are absent', async ({ page }) => {
  // Given a close form previously confirmed both position directions.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    ui: { tradeMode: 'CLOSE' },
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '12' }, { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '34' }],
  }));

  // When native descendants temporarily disappear while the form owner remains connected.
  const action = await page.evaluate(() => {
    document.querySelectorAll('.order-entry button, .order-entry [data-testid^="max-"]').forEach(element => element.remove());
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
    return window.__TM_CLOSE_LONG_DEBUG__.resolveTradeAction();
  });

  // Then no absent native button or missing quantity is treated as an executable close direction.
  expect(action).toBe(null);
  await expect(page.locator('#jh-binance-trade-mode-hint')).toHaveAttribute('title', /正在确认可平仓位/);
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

for (const contextChange of ['mode', 'precision']) {
  for (const eventType of ['input', 'blur']) {
    test(`user discards an old multiplier ${eventType} after native ${contextChange} changes`, async ({ page }) => {
      // Given an active multiplier edit belongs to open mode at precision 0.1.
      const { errors } = await openUserscriptScenario(page, createCancelScenario());
      await page.locator(INPUT).fill('5');

      // When native context changes without moving focus and the old edit then delivers its event.
      if (contextChange === 'mode') {
        await page.locator('#position-direction [data-trade-mode="CLOSE"]').evaluate(element => element.click());
        await expect(page.locator('#position-direction [data-trade-mode="CLOSE"]')).toHaveAttribute('aria-selected', 'true');
      } else {
        await page.evaluate(symbol => window.__BINANCE_FIXTURE__.replacePrecisionControl({
          scope: 'select', symbol, value: '0.01', options: ['0.001', '0.01', '0.1', '1'],
        }), CURRENT_SYMBOL);
      }
      await page.locator(INPUT).evaluate((input, eventType) => {
        input.value = '99';
        if (eventType === 'blur') input.blur();
        else input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '99' }));
      }, eventType);

      // Then the stale event preserves the original setting and cannot save into the replacement scope.
      await expect(page.locator(INPUT)).toHaveValue('1');
      expect(await multiplierValue(page, 'OPEN')).toBe('5');
      expect(await multiplierValue(page, contextChange === 'mode' ? 'CLOSE' : 'OPEN', CURRENT_SYMBOL, contextChange === 'precision' ? '0.01' : '0.1')).toBe(null);
      await expectNoOrderActions(page);
      expect(errors).toEqual([]);
    });
  }
}

test('user keeps the only enabled close direction when pressing navigation keys', async ({ page }) => {
  // Given only the current symbol's short position is available to close.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    ui: { tradeMode: 'CLOSE' }, positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '4' }],
  }));
  const short = page.locator(SHORT);
  await short.focus();

  // When arrow navigation has no other enabled direction to select.
  await short.press('ArrowRight');
  await short.press('ArrowLeft');

  // Then focus and selection remain on the only valid close direction without writing a preference.
  await expect(short).toBeFocused();
  await expect(short).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator(LONG)).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('jh_binance_close_side:HYPEUSDT'))).toBe(null);
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user refreshes the current multiplier when another browser context sends a matching storage event', async ({ page }) => {
  // Given the current panel is not being edited and starts with its default multiplier.
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  await expect(page.locator(INPUT)).toHaveValue('1');

  // When the browser delivers a current-scope storage update followed by an unrelated key.
  await page.evaluate(() => {
    const key = 'jh_binance_qty_multiplier_v2:OPEN:HYPEUSDT:0.1';
    localStorage.setItem(key, '8');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: '8', oldValue: null }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-panel-setting', newValue: '99' }));
  });

  // Then only the matching preference updates the visible quantity calculation.
  await expect(page.locator(INPUT)).toHaveValue('8');
  await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.56');
  expect(await multiplierValue(page, 'OPEN')).toBe('8');
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});

test('user opens a retired close percentage profile with its supported replacement selected', async ({ page }) => {
  // Given the current and another symbol still have the retired saved close percentage
  await page.addInitScript(({ symbol, otherSymbol }) => {
    localStorage.setItem(`jh_binance_ladder_close_percent:${symbol}:0.1`, '100');
    localStorage.setItem(`jh_binance_ladder_close_percent:${otherSymbol}:0.1`, '100');
  }, { symbol: CURRENT_SYMBOL, otherSymbol: OTHER_SYMBOL });

  // When the complete userscript initializes the current symbol's native close panel
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    ui: { tradeMode: 'CLOSE' }, positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '4' }],
  }));

  // Then only the current profile migrates and its supported choice is selected without a migration status message
  const saved = await page.evaluate(({ symbol, otherSymbol }) => ({
    current: localStorage.getItem(`jh_binance_ladder_close_percent:${symbol}:0.1`),
    other: localStorage.getItem(`jh_binance_ladder_close_percent:${otherSymbol}:0.1`),
  }), { symbol: CURRENT_SYMBOL, otherSymbol: OTHER_SYMBOL });
  expect(saved).toEqual({ current: '0.3', other: '100' });
  await expect(page.locator('[data-ladder-group="percent"]')).toHaveText(['0.3%', '1%', '5%', '10%', '30%']);
  expect(await page.locator('[data-ladder-group="percent"][data-ladder-value="0.3"]')
    .evaluate(button => button.style.borderColor)).toBe('var(--color-PrimaryYellow)');
  await expect(page.locator('#jh-binance-ladder-status')).not.toContainText('平仓量 100% 已调整为');
  await expectNoOrderActions(page);
  expect(errors).toEqual([]);
});
