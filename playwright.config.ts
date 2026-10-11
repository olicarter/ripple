import { defineConfig, devices } from '@playwright/test';

// Requires docker-compose stack (postgres + electric): npm run db:up
// The API webServer is started with NODE_ENV=test automatically.
// If you already have a dev API running on :3001, stop it first — the test
// suite needs its own test-mode instance (globalSetup enforces this).
export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  expect: {
    timeout: 15000,
  },
  use: {
    baseURL: 'https://localhost:5174',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    // Use a preinstalled Chromium when the one matching this Playwright version
    // isn't available (e.g. Claude Code cloud sessions, which can't download it).
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'NODE_ENV=test npm run dev --workspace=apps/api',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev --workspace=apps/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'caddy run --config Caddyfile --adapter caddyfile',
      url: 'https://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      ignoreHTTPSErrors: true,
    },
  ],
});
