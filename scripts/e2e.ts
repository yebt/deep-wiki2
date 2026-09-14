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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const INSTALL_COMMAND = 'bun run e2e:install';
/** Where Nuxt writes its per-checkout dev/build lock, apps/web's default `buildDir`. */
const NUXT_LOCK_PATH = join(REPO_ROOT, 'apps', 'web', '.nuxt', 'nuxt.lock');
/** Nuxt's own staleness window for a lock file (`@nuxt/cli`'s `lockfile.ts`: `MAX_LOCK_AGE_MS`). */
const NUXT_LOCK_MAX_AGE_MS = 1440 * 60 * 1000;

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

export interface NuxtLockInfo {
  readonly pid: number;
  readonly startedAt: number;
}

/**
 * Best-effort read of Nuxt's own dev/build lock file (never throws — a
 * missing or malformed file just means "no lock").
 *
 * Checked here, before `playwright test` is even spawned, and deliberately
 * not from inside `e2e/global-setup.ts`: Playwright starts its `webServer`
 * (a `nuxt dev` invocation, playwright.config.ts) independently of
 * `globalSetup`, and in practice does so early enough that by the time
 * `globalSetup` would run, the lock file it finds may already be *this
 * exact run's own* legitimate `nuxt dev` — not a foreign one (verified
 * against this host: the lock's `startedAt` landed within the same second
 * as invoking `bun run e2e`). This preflight runs strictly before any
 * Playwright process for this invocation exists, so any live lock it finds
 * can only belong to a genuinely separate run.
 */
export function readNuxtLock(lockPath: string, readFile: (path: string) => string = (p) => readFileSync(p, 'utf8')): NuxtLockInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(readFile(lockPath));
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { pid?: unknown }).pid === 'number' &&
      typeof (parsed as { startedAt?: unknown }).startedAt === 'number'
    ) {
      return parsed as NuxtLockInfo;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Mirrors Nuxt's own `isLockActive`: a lock is live only for a real, recent process. */
export function isNuxtLockHeld(info: NuxtLockInfo | undefined, now: number, isAlive: (pid: number) => boolean = defaultIsProcessAlive): boolean {
  if (!info) return false;
  if (!isAlive(info.pid)) return false;
  if (now - info.startedAt > NUXT_LOCK_MAX_AGE_MS) return false;
  return true;
}

export interface NuxtLockPreflight {
  ok: boolean;
  message?: string;
}

/** Refuses to start when apps/web's per-checkout Nuxt dev lock is already live. */
export function checkNuxtLock(
  info: NuxtLockInfo | undefined,
  now: number,
  isAlive: (pid: number) => boolean = defaultIsProcessAlive,
): NuxtLockPreflight {
  if (!isNuxtLockHeld(info, now, isAlive)) return { ok: true };
  return {
    ok: false,
    message:
      `apps/web's Nuxt dev lock is already held by pid ${info!.pid} — Nuxt refuses a second "nuxt dev" in the ` +
      'same checkout no matter which port it uses, so DEEPWIKI_TEST_SLOT will not help here. Wait for that run ' +
      'to finish, or run this suite from a different worktree (docs/RUNNING.md §4).',
  };
}

if (import.meta.main) {
  const preflight = checkBrowser(chromium.executablePath(), existsSync);
  if (!preflight.ok) {
    console.error(`e2e: ${preflight.message}`);
    process.exit(1);
  }

  const lockPreflight = checkNuxtLock(readNuxtLock(NUXT_LOCK_PATH), Date.now());
  if (!lockPreflight.ok) {
    console.error(`e2e: ${lockPreflight.message}`);
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
