import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup/browser.js'],
    include: [
      'tests/unit/**/*.test.js',
      'tests/integration/**/*.test.js'
    ],
    coverage: {
      provider: 'v8',
      include: ['extension/lib/**/*.js', 'extension/src/**/*.js'],
      reporter: ['text', 'html']
    }
  }
});
