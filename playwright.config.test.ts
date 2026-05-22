import { defineConfig, devices } from '@playwright/test';

// Parallel test instance that runs alongside a live dev server.
// - API listens on :3101 (test mode) instead of the dev API on :3001
// - Caddy serves :5274 instead of :5174 and routes /api/* to :3101
// - Vite web on :5173 is reused (it's API-agnostic, host header determines proxy)
// Run with: npx playwright test --config=playwright.config.test.ts
export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: 'https://localhost:5274',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'NODE_ENV=test API_PORT=3101 ORIGIN=https://localhost:5274,https://localhost:5174,http://localhost:5173 npm run dev --workspace=apps/api',
      url: 'http://localhost:3101/api/users',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev --workspace=apps/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'caddy run --config Caddyfile.test --adapter caddyfile',
      url: 'https://localhost:5274',
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      ignoreHTTPSErrors: true,
    },
  ],
});
