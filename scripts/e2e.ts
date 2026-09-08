/**
 * `bun run e2e` — the repository-root entry point for the Playwright suite.
 *
 * Until this file existed there was no `e2e` script at the root and
 * `verify` did not run Playwright, so `e2e/` was reachable only from
 * `.github/workflows/ci.yml` — a workflow that has never executed, because
 * this repository has no git remote. Enforcement here is local and always
 * has been. The evidence for "Live Preview Renders In Place"
 * (e2e/editor.spec.ts), for read mode never fetching a ProseMirror bundle
 * at runtime (e2e/read.spec.ts), and for the lock take-over surface
 * (e2e/editor.spec.ts) therefore sat in tests no committed command ran.
 *
 * Everything the suite needs beyond a browser provisions itself:
 * `e2e/global-setup.ts` spawns `e2e/seed.bun.ts`, which brings up this
 * worktree's own Postgres through `packages/db/testing/provision.ts` and
 * starts `apps/api`; `playwright.config.ts`'s `webServer` starts
 * `apps/web`. Every port and compose project name is derived per worktree
 * by `packages/db/testing/worktree.ts`, so two worktrees can run this at
 * the same time without destroying each other's containers.
 *
 * The one prerequisite that cannot provision itself is Playwright's
 * browser binary — a ~150MB download that must not happen implicitly
 * inside a verify run. So this script checks for it first and fails with
 * the exact command to run, rather than letting Playwright fail deep
 * inside a worker with a stack trace about a missing executable.
 *
 * Arguments are passed through: `bun run e2e -- e2e/read.spec.ts --headed`.
 */
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const INSTALL_COMMAND = 'bun run e2e:install';

export interface BrowserPreflight {
  ok: boolean;
  message?: string;
}

/** Pure enough to test: given a path and an existence probe, is the browser there? */
export function checkBrowser(executablePath: string, exists: (path: string) => boolean): BrowserPreflight {
  if (exists(executablePath)) return { ok: true };
  return {
    ok: false,
    message:
      `Playwright's Chromium is not installed (expected at ${executablePath}).\n` +
      `Run \`${INSTALL_COMMAND}\` once, then re-run \`bun run e2e\`.\n` +
      `The e2e suite provisions its own database and servers, but not its browser: ` +
      `downloading ~150MB implicitly inside \`bun run verify\` would be worse than failing here.`,
  };
}

if (import.meta.main) {
  const preflight = checkBrowser(chromium.executablePath(), existsSync);
  if (!preflight.ok) {
    console.error(`e2e: ${preflight.message}`);
    process.exit(1);
  }

  const result = spawnSync('playwright', ['test', '--config', 'playwright.config.ts', ...process.argv.slice(2)], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`e2e: could not start Playwright — ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
