/**
 * Provisions a real backend for the authentication e2e suite
 * (e2e/auth.spec.ts): a freshly migrated, isolated database (the same
 * auto-provisioning harness `packages/db/testing/provision.ts` gives
 * every DB-backed unit suite), seeded with the tokens those tests drive
 * against, plus a live `apps/api` instance pointed at that database.
 *
 * `apps/web`'s own dev server is still started by Playwright's `webServer`
 * (playwright.config.ts) — this file only adds the piece the smoke suite
 * never needed: a real API with real data behind it.
 *
 * Runs under Playwright's own (Node) process. `packages/db/testing/
 * provision.ts` uses `import.meta.dir` (Bun-only) at module load time and
 * cannot be imported here directly, so the actual provisioning/seeding
 * runs in `e2e/seed.bun.ts`, spawned as a `bun` child process — see that
 * file's doc comment.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { API_PORT, API_URL, MAILPIT_SMTP_PORT, WEB_URL } from './ports';

const REPO_ROOT = join(import.meta.dirname, '..');
const FIXTURES_PATH = join(import.meta.dirname, '.auth-fixtures.json');

/**
 * Every field `e2e/seed.bun.ts`'s `main()` prints on its last stdout line —
 * `{ url, dbName, ...seedFixtures()'s return }`. This used to list only the
 * auth-suite fields and worked anyway, because `main()` below spreads
 * `fixtures` straight into `JSON.stringify(...)` untyped: nothing forced
 * the two to agree, so a field seed.bun.ts added (`keyboardEmail`, every
 * onboarding field) was never a compile error here — only a runtime
 * `undefined` wherever a spec expected it. Keep this in step with
 * `seedFixtures`'s return object in seed.bun.ts; see
 * scripts/checks/__tests__/e2e-seed-result-shape.test.ts for the
 * type-level regression guard.
 */
export interface SeedResult {
  readonly url: string;
  readonly dbName: string;
  readonly founderEmail: string;
  readonly colleagueEmail: string;
  readonly superRootEmail: string;
  readonly onboardingPassword: string;
  readonly signinEmail: string;
  readonly signinInvitationToken: string;
  readonly keyboardEmail: string;
  readonly keyboardInvitationToken: string;
  readonly expiredInvitationToken: string;
  readonly resetEmail: string;
  readonly resetToken: string;
  readonly readPageId: string;
  readonly historyPageId: string;
  readonly historyFirstRevisionId: string;
  readonly historySecondRevisionId: string;
  readonly emptyHistoryPageId: string;
  readonly workspaceId: string;
  readonly bookHistoryShelfTitle: string;
  readonly bookHistoryBookId: string;
  readonly bookHistoryBookTitle: string;
  readonly bookHistoryPageAId: string;
  readonly bookHistoryPageBId: string;
  readonly bookDiffSinceIso: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`apps/api did not become healthy within ${timeoutMs}ms: ${String(lastError)}`);
}

/**
 * This file used to spawn apps/api on `API_PORT` and then just poll
 * `${API_URL}/health`. If a second `bun run e2e` starts in the same
 * checkout while a first is still up, the derived port is already bound by
 * the FIRST run's apps/api, our own spawn below fails to bind, and
 * `waitForHealth` happily observes the other run's server anyway — nothing
 * here noticed our own process never came up. The second run then
 * overwrites `.auth-fixtures.json` and, at teardown, drops its own
 * (still in-flight) database, poisoning the run that was already going.
 *
 * Decision: refuse to start, honestly and immediately, rather than making
 * fixtures/seed per-process. A loud refusal naming the exact env var to run
 * alongside it with is honest; silently reusing another run's server is
 * not. (`apps/web`'s dev server has the same shape of problem — Nuxt's own
 * per-checkout lock, not a port collision — but that lock cannot be
 * checked safely from here: Playwright starts its `webServer` independently
 * of `globalSetup`, so by the time this function runs, the lock may already
 * be *this exact run's own* legitimate `nuxt dev`, not a foreign one. See
 * `scripts/e2e.ts`, which checks it before Playwright is even invoked —
 * the only point a lock file found there can belong to someone else.)
 */

/** Probes a port by actually trying to bind it — the only honest EADDRINUSE test. */
function defaultTryListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code !== 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** Refuses to start when `port` is already held by some other process. */
export async function assertPortFree(port: number, label: string, tryListen: (port: number) => Promise<boolean> = defaultTryListen): Promise<void> {
  if (await tryListen(port)) return;
  throw new Error(
    `e2e global-setup: ${label} port ${port} is already in use — another e2e run (or a leftover server) is bound ` +
      'to it. Run alongside it with DEEPWIKI_TEST_SLOT=<1..248> (docs/RUNNING.md §4), or stop the other run first.',
  );
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // Fail fast, before provisioning a database or spawning apps/api: an
  // honest refusal here costs nothing, where the same collision discovered
  // later (via a false-positive health check) has already wasted a
  // database and poisoned another run's fixtures.
  await assertPortFree(API_PORT, 'apps/api');

  const seedOutput = execFileSync('bun', ['run', 'e2e/seed.bun.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // `savePage()`'s `changesetWindowMinutes` is required now — seed.bun.ts
    // threads it from this env var rather than hardcoding a number at each
    // call site. `env.example`'s own value (30) is the only place the
    // number is meant to exist; this is a copy of that fact for the seed
    // script's own environment, the same precedent already set below for
    // the spawned `apps/api` process.
    env: { ...process.env, CHANGESET_WINDOW_MINUTES: '30' },
  });
  const seed: SeedResult = JSON.parse(seedOutput.trim().split('\n').pop()!);

  const blobRoot = mkdtempSync(join(tmpdir(), 'deep-wiki-e2e-blobs-'));

  const apiProcess: ChildProcess = spawn('bun', ['run', 'src/index.ts'], {
    cwd: join(REPO_ROOT, 'apps', 'api'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      DATABASE_URL: seed.url,
      APP_URL: WEB_URL,
      SESSION_IDLE_TIMEOUT_MINUTES: '30',
      SESSION_ABSOLUTE_TIMEOUT_DAYS: '30',
      PASSWORD_RESET_TTL_MINUTES: '30',
      INVITATION_TTL_DAYS: '7',
      // Required since versioning-and-collaboration Phase 5 added it to
      // `packages/contracts/src/env.ts` with no `.default()` — this
      // harness predates that change and never gained it, so every e2e
      // run failed `loadConfig()` before this fix. `env.example`'s own
      // value (30) is the only place the number is meant to exist; this
      // is a copy of that fact for the e2e process's environment, not a
      // second source of truth for it.
      CHANGESET_WINDOW_MINUTES: '30',
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(MAILPIT_SMTP_PORT),
      SMTP_SECURE: 'false',
      MAIL_FROM: 'noreply@deep-wiki.local',
      BLOB_STORE_DRIVER: 'filesystem',
      BLOB_STORE_FS_ROOT: blobRoot,
    },
    stdio: 'inherit',
  });

  await waitForHealth(API_URL, 30_000);

  const { url: _url, dbName, ...fixtures } = seed;
  await writeFile(FIXTURES_PATH, JSON.stringify({ apiUrl: API_URL, ...fixtures }, null, 2));

  return async () => {
    apiProcess.kill();
    try {
      execFileSync('bun', ['run', 'e2e/seed.bun.ts', '--drop', dbName], { cwd: REPO_ROOT, stdio: 'inherit' });
    } catch {
      // Best-effort: a leaked dw_test_* database is a disposable-harness
      // concern, not a reason to fail an otherwise-green e2e run.
    }
  };
}
