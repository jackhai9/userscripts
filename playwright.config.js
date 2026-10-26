import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/binance-orderbook/specs',
  testMatch: '**/*.pw.js',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Spec files use isolated contexts with routed fixtures, so they can run in parallel while
  // tests inside one file stay ordered. Half the logical CPUs is two workers on 4-vCPU CI
  // runners, which keeps headroom for the 3s expectation timeout.
  workers: '50%',
  timeout: 15_000,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  expect: {
    timeout: 3_000,
  },
  outputDir: 'test-results/ui',
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
