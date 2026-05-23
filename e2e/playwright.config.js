// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for E2E tests.
 *
 * Both the API server and the Next.js dev server must be running:
 *   - API:      cd baby-name-bracket-api && npm start   (port 3001)
 *   - Frontend: cd baby-name-bracket-app && npm run dev  (port 3000)
 *
 * These tests do NOT auto-start the servers — run them against a live local
 * environment. Set NEXT_PUBLIC_APP_URL to override the base URL.
 *
 * Run: cd baby-name-bracket-api && npm run test:e2e
 */
module.exports = defineConfig({
  testDir: '.',
  timeout: 30000,
  retries: 0,
  workers: 1,

  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
