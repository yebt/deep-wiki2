import { defineConfig, devices } from '@playwright/test';

import { API_URL, WEB_PORT as PORT, WEB_URL as baseURL } from './e2e/ports';

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
 *
 * `globalSetup` provisions the real backend e2e/auth.spec.ts needs — a
 * migrated, seeded database and a live `apps/api` instance — which the
 * Phase 0 smoke suite never required. See e2e/global-setup.ts.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
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
    // The browser must be told where global-setup started apps/api. Without
    // this the dev server falls back to its compiled default, which is a
    // different port, and every test that talks to the API fails while
    // nothing is actually broken.
    env: { NUXT_PUBLIC_API_BASE_URL: API_URL },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
