import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { buildCompoundCandidateAnnotation } from '../../src/binance-strategy27-events/core/compound-candidate-annotation.js';

// Render the actual panel module with synthetic evidence, without a dev server
// or access to the operator's browser, accounts, or market connections.
const fixtures = JSON.parse(await readFile(new URL('../fixtures/strategy27-compound-candidates.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../../src/binance-strategy27-events/dom/strategy27-event-panel.js', import.meta.url), 'utf8');
const sourceUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const output = await mkdtemp(join(tmpdir(), 'strategy27-compound-panel-'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent('<html lang="zh-CN"><body style="margin:0;background:#F5F5F5"><p style="font:14px system-ui;color:#707A8A;padding:20px">Strategy 27 · Synthetic panel fixture · No live connection</p><div class="chart-widget-root" style="height:900px"></div></body></html>');
  await page.evaluate(async ({ sourceUrl, annotations }) => {
    const { createStrategy27EventPanel } = await import(sourceUrl);
    const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), {
      maxEvents: 8, maxCompoundEvents: 8,
      loadPosition: () => ({ left: 40, top: 80 }), savePosition: () => {},
    });
    window.fixturePanel = panel;
    for (let i = 0; i < 8; i += 1) {
      const annotation = annotations[i % 2];
      panel.upsertCompound(`fixture-${i}`, { ...annotation, eventTimeMs: annotation.eventTimeMs + i * 1000 }, 8000 + i * 1000);
    }
    panel.setCompoundStatus('复合候选已连接', 'normal');
  }, { sourceUrl, annotations: fixtures.map(buildCompoundCandidateAnnotation) });
  const panel = page.locator('#jh-strategy27-event-panel');
  await panel.waitFor({ state: 'visible' });
  assert.equal(await panel.locator('[data-role="compound-row"]').count(), 8);
  assert.match(await panel.locator('[data-role="event-detail"]').textContent(), /镜像规则，尚未独立验证/);
  await panel.screenshot({ path: join(output, 'low-candidate.png') });
  await page.locator('[data-role="compound-row"][data-event-id="fixture-6"]').click();
  assert.match(await panel.locator('[data-role="event-detail"]').textContent(), /复合候选高/);
  await panel.screenshot({ path: join(output, 'high-candidate.png') });
  await page.evaluate(() => window.fixturePanel.setCompoundStatus('复合候选不可用，正在重连', 'inactive'));
  await page.locator('[data-role="collapse"]').click();
  assert.equal(await panel.locator('[data-role="panel-body"]').isVisible(), false);
  await page.locator('[data-role="collapse"]').click();
  assert.equal(await panel.locator('[data-role="compound-status"]').textContent(), '复合候选不可用，正在重连');
  const box = await panel.boundingBox();
  assert.equal(box.width, 322);
  assert.equal(box.x >= 0 && box.y >= 0 && box.y + box.height <= 1000, true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, checked: ['high', 'mirrored-low', 'eight-row-bound', 'collapse', 'status', 'viewport'], pageErrors: errors }));
} finally {
  await browser.close();
}
