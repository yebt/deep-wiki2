/**
 * The argv/environment shell of `bun run -F @deep-wiki/db trash:purge`
 * (`ai-reindex.test.ts`'s own idiom). `purgeTrash()` itself is tested in
 * `src/trash/purge.test.ts` against a real database; the refusal cases here
 * each exit before any connection is opened (`postgres()` connects
 * lazily), so no test below reaches a database. The `--all` iteration case
 * is the one exception and drives the CLI as a real child process against
 * a provisioned test database.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from './testing/provision';

const CLI = join(import.meta.dir, 'trash-purge.ts');
const BASE_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
const DATABASE_URL = 'postgres://u:p@localhost:1/db';

function run(args: readonly string[], env: Record<string, string>): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['bun', 'run', CLI, ...args], { env: { ...BASE_ENV, ...env }, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe('trash:purge — refusals before any database work', () => {
  test('refuses without DATABASE_URL', () => {
    const { exitCode, stderr } = run(['--all'], {});

    expect(exitCode).toBe(1);
    expect(stderr).toContain('DATABASE_URL is not set');
  });

  test('refuses with neither --workspace nor --all', () => {
    const { exitCode, stderr } = run([], { DATABASE_URL });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--workspace <id|slug> or --all is required');
  });

  test('refuses --workspace and --all together', () => {
    const { exitCode, stderr } = run(['--workspace', 'acme', '--all'], { DATABASE_URL });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('mutually exclusive');
  });

  test('rejects a malformed workspace ref — not a uuid and not a slug shape', () => {
    const { exitCode, stderr } = run(['--workspace', 'Not A Valid Ref!'], { DATABASE_URL });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('is not a valid workspace id or slug');
  });

  test('accepts a well-formed uuid ref (fails later, at connection, not at this validation)', () => {
    const { exitCode, stderr } = run(['--workspace', '00000000-0000-0000-0000-000000000000'], { DATABASE_URL });

    expect(exitCode).not.toBe(0);
    expect(stderr).not.toContain('is not a valid workspace id or slug');
  });
});

describe('trash:purge --all — real iteration', () => {
  let db: ProvisionedTestDatabase;
  let sql: postgres.Sql;

  beforeAll(async () => {
    db = await provisionTestDatabase();
    sql = postgres(db.url, { max: 10 });
  });

  afterAll(async () => {
    await sql.end({ timeout: 1 }).catch(() => {});
    await db.drop();
  });

  test('runs one purge per workspace, printing a run line for each', async () => {
    const [ownerA] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`a-${crypto.randomUUID()}@example.com`}, 'hash', 'A') RETURNING id
    `;
    const [ownerB] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`b-${crypto.randomUUID()}@example.com`}, 'hash', 'B') RETURNING id
    `;
    const [wsA] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerA!.id}, 'A', ${`a-${crypto.randomUUID()}`}) RETURNING id`;
    const [wsB] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerB!.id}, 'B', ${`b-${crypto.randomUUID()}`}) RETURNING id`;

    const { exitCode, stdout } = run(['--all'], { DATABASE_URL: db.url });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`workspace ${wsA!.id}`);
    expect(stdout).toContain(`workspace ${wsB!.id}`);

    const runs = await sql<{ workspace_id: string; state: string }[]>`SELECT workspace_id, state FROM trash_purge_runs WHERE workspace_id = ANY(${[wsA!.id, wsB!.id]}::uuid[])`;
    expect(runs).toHaveLength(2);
    expect(runs.every((row) => row.state === 'completed')).toBe(true);
  });

  test('runs a single workspace by slug', async () => {
    const [owner] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name) VALUES (${`c-${crypto.randomUUID()}@example.com`}, 'hash', 'C') RETURNING id
    `;
    const slug = `c-${crypto.randomUUID()}`;
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'C', ${slug}) RETURNING id`;

    const { exitCode, stdout } = run(['--workspace', slug], { DATABASE_URL: db.url });

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`workspace ${ws!.id}`);
  });
});
