import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

/**
 * Root-level Playwright config (not nested under apps/web) — `e2e/` and
 * this file live at the repository root because e2e is cross-cutting
 * infrastructure, not owned by any one app. `apps/web`'s own `e2e` script
 * invokes this file explicitly (`playwright test --config
 * ../../playwright.config.ts`) — see design.md's Testing Strategy table.
 *
 * `webServer` boots `apps/web` in dev mode: it is the fastest reliable
 * startup path and this suite only needs the smoke page to render, not a
 * production bundle (the production build is separately exercised by
 * `bun run build`, task 8.12, and by CI's `verify` job).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `bun run -F @deep-wiki/web dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
