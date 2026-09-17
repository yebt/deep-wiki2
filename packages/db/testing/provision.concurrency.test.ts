import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import {
  createTestDatabase,
  defaultProvisionDeps,
  dropTestDatabase,
  ensureTemplateDatabase,
  provisionTestDatabase,
  resolveAdminUrl,
  TEST_DB_PREFIX,
} from './provision';

/**
 * `bun run test` runs every package's suite at once (`--filter '*'`), and
 * `packages/db` and `apps/api` both provision `deepwiki_test_template`
 * from their own process. Measured 2026-09-17: one of the two lost with
 * `duplicate key value violates unique constraint "pg_database_datname_index"`
 * — both saw no template, both created it — and 85 suites failed that
 * pass alone. A second race hides behind the first: `CREATE DATABASE …
 * TEMPLATE` refuses while anyone is connected to the template, and the
 * other process is connected to it exactly then, migrating.
 *
 * Two processes cannot be driven from one `bun test`, but what each does
 * can: `ensureTemplateDatabase` memoises nothing (the memo is
 * `provisionTestDatabase`'s, per process), so three of them at once,
 * each followed by a copy, is three processes as Postgres sees them. The
 * template is this test's own (`dw_test_` so it can be dropped), against
 * the real harness Postgres every other suite in this package uses.
 */
const TEMPLATE = `${TEST_DB_PREFIX}template_race`;
/** Generous: a drop of a database Postgres is still analysing waits for that worker to go (measured 4 s once), and the harness may be starting. */
const TIMEOUT_MS = 120_000;

async function tableCount(url: string): Promise<number> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from pg_tables where schemaname = 'public'`;
    return row!.count;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function dropAll(adminUrl: string, names: readonly string[]): Promise<void> {
  for (const name of names) await dropTestDatabase(adminUrl, name);
}

describe('template provisioning under concurrency', () => {
  test(
    'three provisioners racing for one template: it is created once, migrated once at a time, and every copy is a migrated copy',
    async () => {
      const adminUrl = await resolveAdminUrl(defaultProvisionDeps);
      await dropTestDatabase(adminUrl, TEMPLATE);
      const copies = [0, 1, 2].map(() => `${TEST_DB_PREFIX}race_${randomBytes(6).toString('hex')}`);

      try {
        const outcomes = await Promise.allSettled(
          copies.map(async (name) => {
            await ensureTemplateDatabase(adminUrl, undefined, TEMPLATE);
            await createTestDatabase(adminUrl, name, TEMPLATE);
          }),
        );

        expect(outcomes.map((outcome) => (outcome.status === 'rejected' ? String(outcome.reason) : 'fulfilled'))).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);

        const templateTables = await tableCount(new URL(`/${TEMPLATE}`, adminUrl).toString());
        expect(templateTables).toBeGreaterThan(0);
        for (const name of copies) {
          expect(await tableCount(new URL(`/${name}`, adminUrl).toString())).toBe(templateTables);
        }
      } finally {
        await dropAll(adminUrl, [...copies, TEMPLATE]);
      }
    },
    TIMEOUT_MS,
  );

  test(
    'two provisionTestDatabase() calls at once in one process share the template and each gets its own copy',
    async () => {
      const [first, second] = await Promise.all([provisionTestDatabase(), provisionTestDatabase()]);
      try {
        expect(first.name).not.toBe(second.name);
        expect(await tableCount(first.url)).toBe(await tableCount(second.url));
      } finally {
        await first.drop();
        await second.drop();
      }
    },
    TIMEOUT_MS,
  );
});
