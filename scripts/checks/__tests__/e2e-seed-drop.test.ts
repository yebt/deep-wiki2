/**
 * `e2e/seed.bun.ts --drop <dbName>` is the teardown half of
 * e2e/global-setup.ts — the exact thing every e2e run's `afterAll` invokes
 * to remove its disposable database. `8c89a06` made
 * `SavePageInput.changesetWindowMinutes` required and threaded it into this
 * script via `process.env.CHANGESET_WINDOW_MINUTES`, but the module-level
 * guard that enforces it runs unconditionally — before `--drop` is even
 * inspected — so teardown throws and leaks its `dw_test_*` database on
 * every run, because global-setup.ts's teardown spawns this exact command
 * with no such variable set (see the `execFileSync` call in its returned
 * teardown function).
 *
 * A teardown that needs a save-time constant to delete a database is wrong
 * by shape: dropping never calls `savePage()`, so it must not depend on
 * anything `savePage()` needs. This test runs the real command, exactly as
 * global-setup.ts's teardown runs it (no `env` override, so the variable is
 * absent unless it happens to be in the ambient shell), against a real
 * disposable database, and proves the database is actually gone afterwards
 * — not just that the process exited zero.
 */
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import postgres from 'postgres';
import { defaultProvisionDeps, provisionTestDatabase, resolveAdminUrl } from '@deep-wiki/db/testing/provision';

const ROOT = join(import.meta.dir, '..', '..', '..');

describe('e2e/seed.bun.ts --drop', () => {
  test('drops a real database with CHANGESET_WINDOW_MINUTES absent from its environment', async () => {
    const db = await provisionTestDatabase();

    // Exactly global-setup.ts's teardown call: no `env` override at all, so
    // this child process inherits only the ambient environment — which,
    // unlike the seed call, is never given CHANGESET_WINDOW_MINUTES.
    const env = { ...process.env };
    delete env.CHANGESET_WINDOW_MINUTES;

    execFileSync('bun', ['run', 'e2e/seed.bun.ts', '--drop', db.name], {
      cwd: ROOT,
      env,
      stdio: 'pipe',
    });

    const adminUrl = await resolveAdminUrl(defaultProvisionDeps);
    const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      const rows = await sql<{ datname: string }[]>`select datname from pg_database where datname = ${db.name}`;
      expect(rows.length).toBe(0);
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }, 30_000);
});
