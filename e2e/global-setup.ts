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
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { API_PORT, API_URL, MAILPIT_SMTP_PORT, WEB_URL } from './ports';

const REPO_ROOT = join(import.meta.dirname, '..');
const FIXTURES_PATH = join(import.meta.dirname, '.auth-fixtures.json');

interface SeedResult {
  readonly url: string;
  readonly dbName: string;
  readonly signinEmail: string;
  readonly signinInvitationToken: string;
  readonly expiredInvitationToken: string;
  readonly resetEmail: string;
  readonly resetToken: string;
  readonly readPageId: string;
  readonly historyPageId: string;
  readonly emptyHistoryPageId: string;
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

export default async function globalSetup(): Promise<() => Promise<void>> {
  const seedOutput = execFileSync('bun', ['run', 'e2e/seed.bun.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
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
