import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The canary runs serially — one browser, one network round-trip to prod.
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Canary hits real seobandwagon.com — don't record screenshots/video by
    // default (would bloat artifacts for no benefit on a weekly run).
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
