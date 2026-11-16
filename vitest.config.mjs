import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // 1.13.8 (#74): coverage slows the tests that parse saved Google pages in
    // jsdom past the 5 s default (measured: 37 of them timed out), and CI now
    // always runs with coverage.
    testTimeout: 30000,
    setupFiles: ['tests/setup/browser.js'],
    include: [
      'tests/unit/**/*.test.js',
      'tests/integration/**/*.test.js'
    ],
    // 1.13.8 (#74): CI runs the suite once with coverage (npm run
    // test:coverage), puts the summary in the job summary
    // (scripts/coverage-summary.mjs reads json-summary) and keeps the HTML
    // report 7 days. No threshold until the baseline has been watched.
    coverage: {
      provider: 'v8',
      include: ['extension/lib/**/*.js', 'extension/src/**/*.js'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // A report on every PR, a red one too (vitest writes none on a failed
      // run by default).
      reportOnFailure: true
    }
  }
});
